/**
 * WCAG 2.1 AA Relative Luminance and Contrast Ratio calculation.
 * docs/UI-UX/17 & docs/UI-UX/08 § Contrast & Accessibility
 */

function sRgbToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.03928 ? norm / 12.92 : ((norm + 0.055) / 1.055) ** 2.4;
}

export function hexToLuminance(hex: string): number {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean;

  const r = Number.parseInt(full.slice(0, 2), 16) || 0;
  const g = Number.parseInt(full.slice(2, 4), 16) || 0;
  const b = Number.parseInt(full.slice(4, 6), 16) || 0;

  return (
    0.2126 * sRgbToLinear(r) +
    0.7152 * sRgbToLinear(g) +
    0.0722 * sRgbToLinear(b)
  );
}

export function calculateContrastRatio(fgHex: string, bgHex: string): number {
  try {
    const l1 = hexToLuminance(fgHex);
    const l2 = hexToLuminance(bgHex);
    const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
    const ratio = (light + 0.05) / (dark + 0.05);
    return Math.round(ratio * 100) / 100;
  } catch {
    return 1;
  }
}

export interface ContrastResult {
  ratio: number;
  passesNormalText: boolean; // >= 4.5
  passesLargeText: boolean; // >= 3.0
  warningMessage?: string;
}

export function evaluateWcagContrast(
  fgHex: string,
  bgHex: string,
): ContrastResult {
  const ratio = calculateContrastRatio(fgHex, bgHex);
  const passesNormalText = ratio >= 4.5;
  const passesLargeText = ratio >= 3.0;

  const result: ContrastResult = {
    ratio,
    passesNormalText,
    passesLargeText,
  };

  if (!passesNormalText) {
    result.warningMessage = `Peringatan Aksesibilitas WCAG AA: Rasio kontras (${ratio}:1) berada di bawah standar minimum 4.5:1 untuk teks normal. Warna teks mungkin sulit dibaca di atas warna latar belakang.`;
  }

  return result;
}
