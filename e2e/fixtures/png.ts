import { inflateSync } from "node:zlib";

/**
 * A decoder for exactly the PNGs Playwright writes: 8-bit, RGB or RGBA, not interlaced.
 *
 * Enough to read a pixel back out of a screenshot without adding an image library to the
 * workspace for one assertion. Anything else is refused loudly rather than misread.
 */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGB at (x, y), channels in 0..255. */
  at(x: number, y: number): readonly [number, number, number];
}

export function decodePng(buffer: Buffer): Pixels {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const depth = buffer[24];
  const colour = buffer[25];
  const interlace = buffer[28];
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) {
    throw new Error(
      `unsupported PNG: depth ${String(depth)}, colour type ${String(colour)}`,
    );
  }
  const channels = colour === 6 ? 4 : 3;

  const chunks: Buffer[] = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT")
      chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[y * stride + x - channels]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const upLeft =
        y > 0 && x >= channels ? out[(y - 1) * stride + x - channels]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[y * stride + x] = (line[x]! + predicted) & 0xff;
    }
  }

  return {
    width,
    height,
    at(x, y) {
      const i = (y * width + x) * channels;
      return [out[i]!, out[i + 1]!, out[i + 2]!];
    },
  };
}

/** WCAG 2 relative luminance of an sRGB colour. */
export function luminance([r, g, b]: readonly [
  number,
  number,
  number,
]): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: number, b: number): number {
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}
