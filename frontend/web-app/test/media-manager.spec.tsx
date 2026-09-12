import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axeViolationIds } from "@wi/ui/src/testing/axe.js";
import { MEDIA_PURPOSES } from "@wi/schema";

import {
  MAX_FILE_BYTES,
  preCheck,
  UploadQueue,
  type UploadItem,
  type UploadTransport,
} from "../src/editor/media/upload-queue";
import { moveItem, ReorderSender } from "../src/editor/media/reorder";
import { MapPicker, round } from "../src/editor/media/MapPicker";

/**
 * P1-24 — the media manager and the map picker.
 *
 * The DoD is four claims, and three of them are about a batch surviving something going
 * wrong: ten files with per-file progress and none lost, a rejected upload that leaves the
 * rest alone, and reordering that works without a mouse. The fourth — coordinates the events
 * endpoint accepts — is about a number's precision.
 */

const file = (name: string, size = 1_000): File =>
  new File([new Uint8Array(size)], name, { type: "image/jpeg" });

/** A transport that resolves immediately and reports what it was asked to do. */
function transportOf(
  behaviour: {
    failOn?: readonly string[];
    processingRounds?: number;
    pollStatus?: (attempt: number) => string;
  } = {},
) {
  const uploaded: string[] = [];
  const polled: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const attempts = new Map<string, number>();

  const transport: UploadTransport = {
    upload: async (f, onProgress) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      uploaded.push(f.name);
      onProgress(10);

      await Promise.resolve();

      try {
        if (behaviour.failOn?.includes(f.name) === true) {
          const seen = (attempts.get(f.name) ?? 0) + 1;
          attempts.set(f.name, seen);
          // Fail only the first attempt, so a retry can succeed.
          if (seen === 1) throw new Error("Jaringan bermasalah.");
        }
        onProgress(100);
        return { mediaId: `media-${f.name}` };
      } finally {
        inFlight -= 1;
      }
    },
    poll: async (mediaId) => {
      polled.push(mediaId);
      const round_ = polled.filter((p) => p === mediaId).length;
      const status = behaviour.pollStatus?.(round_);
      if (status !== undefined) return { status };

      return round_ > (behaviour.processingRounds ?? 0)
        ? { status: "ready", url: `https://cdn.test/${mediaId}.webp` }
        : { status: "processing" };
    },
  };

  return { transport, uploaded, polled, peak: () => peak };
}

function queueOf(
  transport: UploadTransport,
  options: { concurrency?: number } = {},
) {
  const snapshots: (readonly UploadItem[])[] = [];

  const queue = new UploadQueue({
    transport,
    onChange: (items) => {
      snapshots.push(items.map((i) => ({ ...i })));
    },
    ...(options.concurrency !== undefined
      ? { concurrency: options.concurrency }
      : {}),
    pollIntervalMs: 1,
    createObjectUrl: () => "blob:preview",
    revokeObjectUrl: () => undefined,
    sleep: async () => undefined,
  });

  return { queue, snapshots, latest: () => queue.items };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ DoD item 1

describe("uploading ten photos (card DoD 1)", () => {
  it("all ten arrive, each with its own progress", async () => {
    const { transport, uploaded } = transportOf();
    const { queue } = queueOf(transport);

    const names = Array.from(
      { length: 10 },
      (_, i) => `photo-${String(i)}.jpg`,
    );
    queue.add(names.map((n) => file(n)));

    await waitFor(() => {
      expect(queue.items.every((i) => i.state === "ready")).toBe(true);
    });

    expect(uploaded.sort()).toEqual([...names].sort());
    expect(queue.items).toHaveLength(10);
    for (const item of queue.items) {
      expect(item.progress).toBe(100);
      expect(item.url).toContain("cdn.test");
    }
  });

  it("runs at most three at a time", async () => {
    // `docs/FRONTEND/05` asks for the cap, and the reason is the user's connection: ten
    // simultaneous multipart uploads on a phone means ten that are all slow and no visible
    // progress anywhere for a minute.
    const { transport, peak } = transportOf();
    const { queue } = queueOf(transport);

    queue.add(Array.from({ length: 10 }, (_, i) => file(`p-${String(i)}.jpg`)));

    await waitFor(() => {
      expect(queue.items.every((i) => i.state === "ready")).toBe(true);
    });

    expect(peak()).toBeLessThanOrEqual(3);
  });

  it("shows a local preview before anything is sent", async () => {
    // `docs/FRONTEND/05` step 2. A grid that stays empty until the server answers feels
    // broken, and the user has already seen the photo they picked.
    const { transport } = transportOf();
    const { queue } = queueOf(transport);

    const [item] = queue.add([file("a.jpg")]);

    expect(item!.previewUrl).toBe("blob:preview");
    expect(item!.state).toBe("queued");
  });

  it("polls until the worker finishes, then swaps in the CDN url", async () => {
    const { transport, polled } = transportOf({ processingRounds: 2 });
    const { queue } = queueOf(transport);

    queue.add([file("a.jpg")]);

    await waitFor(() => {
      expect(queue.items[0]!.state).toBe("ready");
    });
    expect(polled.length).toBeGreaterThanOrEqual(3);
    expect(queue.items[0]!.url).toBe("https://cdn.test/media-a.jpg.webp");
  });

  it("treats a failed worker verdict as final, not as another poll", async () => {
    // Infected, undecodable, too large in pixels — `P1-18`'s decisions are permanent, and
    // polling past one would spin forever against a row that will never change.
    const { transport } = transportOf({ pollStatus: () => "failed" });
    const { queue } = queueOf(transport);

    queue.add([file("a.jpg")]);

    await waitFor(() => {
      expect(queue.items[0]!.state).toBe("failed");
    });
    expect(queue.items[0]!.error).toMatch(/tidak dapat diproses/i);
  });

  it("gives up polling rather than spinning forever", async () => {
    // `P1-18`'s job can be lost if Redis blinked. A spinner that never resolves is worse
    // than an honest failure with a retry.
    let now = 0;
    const { transport } = transportOf({ pollStatus: () => "processing" });
    const queue = new UploadQueue({
      transport,
      onChange: () => undefined,
      pollIntervalMs: 1,
      pollTimeoutMs: 50,
      createObjectUrl: () => "blob:x",
      revokeObjectUrl: () => undefined,
      now: () => {
        now += 20;
        return now;
      },
      sleep: async () => undefined,
    });

    queue.add([file("a.jpg")]);

    await waitFor(() => {
      expect(queue.items[0]!.state).toBe("failed");
    });
    expect(queue.items[0]!.error).toMatch(/terlalu lama/i);
  });
});

// ------------------------------------------------------------------ DoD item 3

describe("a rejected upload (card DoD 3)", () => {
  it("fails one file and leaves the others alone", async () => {
    const { transport, uploaded } = transportOf({ failOn: ["bad.jpg"] });
    const { queue } = queueOf(transport);

    queue.add([file("good-1.jpg"), file("bad.jpg"), file("good-2.jpg")]);

    await waitFor(() => {
      expect(queue.items.every((i) => i.state !== "uploading")).toBe(true);
    });

    const byName = new Map(queue.items.map((i) => [i.fileName, i]));
    expect(byName.get("bad.jpg")!.state).toBe("failed");
    expect(byName.get("good-1.jpg")!.state).toBe("ready");
    expect(byName.get("good-2.jpg")!.state).toBe("ready");
    expect(uploaded).toContain("good-2.jpg");
  });

  it("carries a human message, never a code", async () => {
    const { transport } = transportOf({ failOn: ["bad.jpg"] });
    const { queue } = queueOf(transport);

    queue.add([file("bad.jpg")]);

    await waitFor(() => {
      expect(queue.items[0]!.state).toBe("failed");
    });
    expect(queue.items[0]!.error).toBe("Jaringan bermasalah.");
  });

  it("retries the same item, keeping its place and its preview", async () => {
    const { transport } = transportOf({ failOn: ["bad.jpg"] });
    const { queue } = queueOf(transport);

    queue.add([file("first.jpg"), file("bad.jpg")]);
    await waitFor(() => {
      expect(queue.items[1]!.state).toBe("failed");
    });

    const id = queue.items[1]!.id;
    queue.retry(id);

    await waitFor(() => {
      expect(queue.items[1]!.state).toBe("ready");
    });
    // Same item, same position, same preview — `docs/FRONTEND/05` step 6's "without losing
    // context".
    expect(queue.items[1]!.id).toBe(id);
    expect(queue.items[1]!.previewUrl).toBe("blob:preview");
    expect(queue.items[0]!.fileName).toBe("first.jpg");
  });

  it("ignores a retry for something that did not fail", () => {
    const { transport } = transportOf();
    const { queue } = queueOf(transport);
    const [item] = queue.add([file("a.jpg")]);

    queue.retry(item!.id);

    expect(queue.items).toHaveLength(1);
  });
});

describe("the client pre-check", () => {
  it.each([
    ["document.pdf", /JPG, PNG, atau WebP/],
    ["photo.gif", /JPG, PNG, atau WebP/],
    ["no-extension", /JPG, PNG, atau WebP/],
  ])("refuses %s", (name, expected) => {
    expect(preCheck(file(name))).toMatch(expected);
  });

  it("refuses a file over 10 MB", () => {
    expect(preCheck(file("big.jpg", MAX_FILE_BYTES + 1))).toMatch(/10 MB/);
  });

  it("accepts what the server accepts", () => {
    expect(preCheck(file("photo.JPG"))).toBeUndefined();
    expect(preCheck(file("photo.webp"))).toBeUndefined();
  });

  it("does not check magic bytes, because that would mean reading the file", () => {
    // `docs/SECURITY/06` is enforced by the server and `P1-17` built all five layers there.
    // This is fast feedback, deliberately weaker.
    const renamed = new File(
      [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
      "x.jpg",
      {
        type: "image/jpeg",
      },
    );
    expect(preCheck(renamed)).toBeUndefined();
  });
});

// ------------------------------------------------------------------ DoD item 2

describe("reordering by keyboard (card DoD 2)", () => {
  it("moves an item and returns a new array", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 2, 0)).toEqual(["c", "a", "b"]);
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("does nothing for an out-of-range move rather than wrapping", () => {
    // The first item's "move up" is disabled; a keyboard user who reaches it anyway should
    // get nothing, not a surprise jump to the bottom.
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 2)).toEqual(["a", "b"]);
  });

  it("sends one reorder per pause, carrying the final arrangement", async () => {
    // Eight "move up" presses in four seconds would otherwise be eight calls each carrying a
    // DIFFERENT complete order, arriving out of sequence, with the last to land winning —
    // which may not be the one the user finished on.
    const sent: string[][] = [];
    const sender = new ReorderSender(
      async (ids) => {
        sent.push([...ids]);
      },
      () => undefined,
      5,
    );

    sender.queue(["a", "b", "c"]);
    sender.queue(["b", "a", "c"]);
    sender.queue(["c", "b", "a"]);
    await sender.flush();

    expect(sent).toEqual([["c", "b", "a"]]);
  });

  it("reports a failure instead of snapping the order back", async () => {
    // The order the user sees is already applied locally. Reverting twelve photos silently
    // is a worse experience than a message saying it was not saved.
    const errors: string[] = [];
    const sender = new ReorderSender(
      async () => {
        throw new Error("Urutan gagal disimpan.");
      },
      (message) => {
        errors.push(message);
      },
      1,
    );

    sender.queue(["a"]);
    await sender.flush();

    expect(errors).toEqual(["Urutan gagal disimpan."]);
  });

  it("never runs two reorder calls at once", async () => {
    let concurrent = 0;
    let peak = 0;
    const sender = new ReorderSender(
      async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await Promise.resolve();
        concurrent -= 1;
      },
      () => undefined,
      1,
    );

    sender.queue(["a"]);
    const first = sender.flush();
    sender.queue(["b"]);
    await Promise.all([first, sender.flush()]);

    expect(peak).toBe(1);
  });
});

// ------------------------------------------------------------------ DoD item 4

describe("the map picker (card DoD 4)", () => {
  it("emits coordinates at the precision the column stores", () => {
    // `DECIMAL(9,6)`. Sending more would be silently truncated, so the value the user sees
    // and the value that comes back would differ.
    expect(round(-6.208812345)).toBe(-6.208812);
    expect(round(106.845600000001)).toBe(106.8456);
  });

  it("is usable without a map at all", async () => {
    // MapLibre needs WebGL, which jsdom does not have and some corporate browsers disable.
    // A picker that existed only as a map would be a field a subset of users could not fill
    // in — and no test here could exercise it.
    //
    // The harness holds the value because the picker is CONTROLLED, as it is in the editor:
    // without a parent that stores each change, every keystroke replaces the last and the
    // field never accumulates a number. Rendering it uncontrolled here would have tested a
    // component the product does not have.
    const seen: { latitude: number; longitude: number }[] = [];

    function Harness() {
      const [position, setPosition] = useState<{
        latitude: number | undefined;
        longitude: number | undefined;
      }>({ latitude: undefined, longitude: undefined });

      return (
        <MapPicker
          latitude={position.latitude}
          longitude={position.longitude}
          onChange={(next) => {
            seen.push(next);
            setPosition(next);
          }}
        />
      );
    }

    render(<Harness />);

    // `getByRole`, not `getByLabelText`: the map container's own aria-label mentions the
    // coordinate fields (it tells a screen-reader user they are the way in), so a text query
    // matches both. A number input is a `spinbutton`.
    await userEvent.type(
      screen.getByRole("spinbutton", { name: /lintang/i }),
      "-6.2088",
    );

    expect(seen.at(-1)!.latitude).toBeCloseTo(-6.2088, 4);
  });

  it("labels both coordinate inputs", () => {
    render(<MapPicker latitude={-6.2} longitude={106.8} onChange={vi.fn()} />);

    expect(screen.getByRole("spinbutton", { name: /lintang/i })).toHaveValue(
      -6.2,
    );
    expect(screen.getByRole("spinbutton", { name: /bujur/i })).toHaveValue(
      106.8,
    );
  });

  it("tells a screen reader that the inputs are the way in", () => {
    render(
      <MapPicker
        latitude={undefined}
        longitude={undefined}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("application", { name: /alternatif/i }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <MapPicker latitude={-6.2} longitude={106.8} onChange={vi.fn()} />,
    );

    expect(await axeViolationIds(container)).toEqual([]);
  });
});

describe("the shared media purpose", () => {
  it("is the vocabulary docs/API/05 names", () => {
    // One definition for the API's validation and the editor's upload. Two copies would
    // disagree the first time a fourth value was added, and the disagreement would surface
    // as a 400 on a screen that looked correct.
    expect(MEDIA_PURPOSES).toEqual(["cover", "gallery", "profile"]);
  });
});
