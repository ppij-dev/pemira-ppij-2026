import { describe, expect, it } from "vitest";
import { startTurnoutPoller, type TurnoutPayload } from "../src/lib/turnoutPoller";

/**
 * Regresi ticker Suara Masuk mandeg (laporan owner 2026-11-23): di produksi
 * laporan polling berhenti terlihat mati saat limit per IP habis (429 diabaikan
 * senyap) dan tab tersembunyi. Perilaku yang dikunci di sini:
 *   - polling tak pernah berhenti setelah non-OK/galat: mundur, lalu lanjut;
 *   - setiap permintaan memakai cache "no-store";
 *   - jeda kembali ke interval dasar setelah sukses;
 *   - berhenti saat tab tersembunyi, polling segera saat terlihat kembali;
 *   - perubahan angka di badan respons selalu sampai ke apply.
 */

const OPEN_MS = 15_000;

function makeTimer() {
  let now = 0;
  let seq = 0;
  const tasks = new Map<number, { fn: () => void; at: number }>();
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return {
    set(fn: () => void, ms: number): number {
      seq += 1;
      tasks.set(seq, { fn, at: now + ms });
      return seq;
    },
    clear(handle: unknown): void {
      tasks.delete(handle as number);
    },
    /** Jalankan semua tugas terjadwal hingga `ms` ke depan, urut waktu. */
    async advance(ms: number): Promise<void> {
      const end = now + ms;
      for (;;) {
        const due = [...tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        tasks.delete(due[0]);
        due[1].fn();
        await flush();
      }
      now = end;
    },
  };
}

function makeVisibility() {
  const listeners: Array<() => void> = [];
  const port = {
    hidden: false,
    addEventListener(_type: "visibilitychange", listener: () => void): void {
      listeners.push(listener);
    },
    set(state: boolean): void {
      port.hidden = state;
      listeners.forEach((l) => l());
    },
  };
  return port;
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/** Server tiruan: antrean respons berikutnya, default sukses. */
function makeFetch(queue: Array<{ status: number; body?: unknown | Error }> = []) {
  const calls: FetchCall[] = [];
  let served = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    const next = queue[Math.min(served, queue.length - 1)] ?? { status: 200 };
    served += 1;
    if (next.body instanceof Error) throw next.body;
    const body = next.body ?? { stage: "open", eligible_count: 397, votes_count: 30, updated_at: "2026-11-23T03:00:00.000Z" };
    return new Response(JSON.stringify(body), { status: next.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function payloadOf(overrides: Partial<TurnoutPayload> = {}): TurnoutPayload {
  return { stage: "open", eligible_count: 397, votes_count: 30, updated_at: "2026-11-23T03:00:00.000Z", ...overrides };
}

describe("polling /api/turnout", () => {
  it("permintaan memakai cache no-store", async () => {
    const timer = makeTimer();
    const fetcher = makeFetch();
    const visibility = makeVisibility();
    const applied: TurnoutPayload[] = [];
    startTurnoutPoller({ apply: (d) => applied.push(d), baseIntervalMs: () => OPEN_MS, initialStage: "open", fetchImpl: fetcher.impl, timer, visibility });
    await timer.advance(OPEN_MS + 2_000);
    expect(fetcher.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of fetcher.calls) {
      expect(call.url).toBe("/api/turnout");
      expect(call.init?.cache).toBe("no-store");
    }
    expect(applied.length).toBe(fetcher.calls.length);
  });

  it("setelah sukses jeda kembali ke interval dasar tahap terkini", async () => {
    const timer = makeTimer();
    const visibility = makeVisibility();
    const fetcher = makeFetch([
      { status: 200, body: payloadOf({ stage: "open" }) },
      { status: 200, body: payloadOf({ stage: "closed" }) },
    ]);
    let intervalUsed = "";
    const poller = startTurnoutPoller({
      apply: () => {},
      initialStage: "open",
      baseIntervalMs: (stage) => {
        intervalUsed = String(stage);
        return stage === "open" ? OPEN_MS : 60_000;
      },
      fetchImpl: fetcher.impl,
      timer,
      visibility,
    });
    await timer.advance(OPEN_MS + 2_000);
    // Sukses pertama: tahap open, interval dasar 15 s + jitter maks 2 s.
    expect(intervalUsed).toBe("open");
    expect(poller.pendingDelayMs()).toBeGreaterThanOrEqual(OPEN_MS);
    expect(poller.pendingDelayMs()).toBeLessThanOrEqual(OPEN_MS + 2_000);
    await timer.advance(OPEN_MS + 2_000);
    // Sukses kedua: tahap closed, interval dasar 60 s + jitter.
    expect(intervalUsed).toBe("closed");
    expect(poller.pendingDelayMs()).toBeGreaterThanOrEqual(60_000);
    expect(poller.failures()).toBe(0);
  });

  it("429 dan galat jaringan membuat mundur namun polling terus berjalan", async () => {
    const timer = makeTimer();
    const visibility = makeVisibility();
    const fetcher = makeFetch([
      { status: 429, body: { error: "rate_limited" } },
      { status: 500, body: new Error("network down") },
      { status: 200, body: payloadOf({ votes_count: 31 }) },
    ]);
    const applied: TurnoutPayload[] = [];
    const poller = startTurnoutPoller({ apply: (d) => applied.push(d), baseIntervalMs: () => OPEN_MS, initialStage: "open", fetchImpl: fetcher.impl, timer, visibility });
    await timer.advance(OPEN_MS + 2_000);
    // 429: mundur 2x interval dasar, tapi tetap ada jadwal (tidak mati).
    expect(fetcher.calls.length).toBe(1);
    expect(poller.failures()).toBe(1);
    expect(poller.pendingDelayMs()).toBeGreaterThanOrEqual(2 * OPEN_MS);
    await timer.advance(2 * OPEN_MS + 2_000);
    // Galat jaringan: mundur 4x interval dasar.
    expect(fetcher.calls.length).toBe(2);
    expect(poller.failures()).toBe(2);
    expect(poller.pendingDelayMs()).toBeGreaterThanOrEqual(4 * OPEN_MS);
    await timer.advance(4 * OPEN_MS + 2_000);
    // Sukses menyusul: angka baru sampai ke apply, kegagalan nol, jeda normal.
    expect(fetcher.calls.length).toBe(3);
    expect(applied).toEqual([payloadOf({ votes_count: 31 })]);
    expect(poller.failures()).toBe(0);
    expect(poller.pendingDelayMs()).toBeGreaterThanOrEqual(OPEN_MS);
    expect(poller.pendingDelayMs()).toBeLessThanOrEqual(OPEN_MS + 2_000);
  });

  it("mundur dibatasi batas atas lalu tetap mencoba tanpa henti", async () => {
    const timer = makeTimer();
    const visibility = makeVisibility();
    const fetcher = makeFetch([{ status: 503 }]);
    const poller = startTurnoutPoller({
      apply: () => {},
      baseIntervalMs: () => OPEN_MS,
      initialStage: "open",
      fetchImpl: fetcher.impl,
      timer,
      visibility,
      maxBackoffMs: 60_000,
    });
    // Banyak kegagalan beruntun: jeda mentok 60 s (plus jitter maks 2 s).
    for (let i = 0; i < 10; i++) await timer.advance(62_000);
    expect(poller.failures()).toBe(fetcher.calls.length);
    expect(poller.failures()).toBeGreaterThanOrEqual(10);
    expect(poller.pendingDelayMs()).toBeGreaterThan(0);
    expect(poller.pendingDelayMs()).toBeLessThanOrEqual(62_000);
  });

  it("payload tidak sah dianggap gagal dan tidak sampai ke apply", async () => {
    const timer = makeTimer();
    const visibility = makeVisibility();
    const fetcher = makeFetch([{ status: 200, body: { hello: "world" } }]);
    const applied: TurnoutPayload[] = [];
    const poller = startTurnoutPoller({ apply: (d) => applied.push(d), baseIntervalMs: () => OPEN_MS, initialStage: "open", fetchImpl: fetcher.impl, timer, visibility });
    await timer.advance(OPEN_MS + 2_000);
    expect(applied).toEqual([]);
    expect(poller.failures()).toBe(1);
    expect(poller.pendingDelayMs()).toBeGreaterThanOrEqual(2 * OPEN_MS);
  });

  it("tab tersembunyi tidak men-polling; terlihat lagi polling segera", async () => {
    const timer = makeTimer();
    const visibility = makeVisibility();
    const fetcher = makeFetch();
    const applied: TurnoutPayload[] = [];
    const poller = startTurnoutPoller({ apply: (d) => applied.push(d), baseIntervalMs: () => OPEN_MS, initialStage: "open", fetchImpl: fetcher.impl, timer, visibility });
    // Dibuka di tab latar: satu jadwal awal terpasang, lalu disembunyikan.
    visibility.set(true);
    expect(poller.pendingDelayMs()).toBeNull();
    const callsWhileHidden = fetcher.calls.length;
    await timer.advance(120_000);
    expect(fetcher.calls.length).toBe(callsWhileHidden);
    expect(applied).toEqual([]);
    // Terlihat kembali: polling segera tanpa menunggu interval.
    visibility.set(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher.calls.length).toBe(callsWhileHidden + 1);
    expect(applied).toEqual([payloadOf({})]);
  });

  it("halaman yang dibuka langsung tersembunyi menunggu fokus, lalu polling", async () => {
    const timer = makeTimer();
    const visibility = makeVisibility();
    visibility.hidden = true;
    const fetcher = makeFetch();
    const applied: TurnoutPayload[] = [];
    startTurnoutPoller({ apply: (d) => applied.push(d), baseIntervalMs: () => OPEN_MS, initialStage: "open", fetchImpl: fetcher.impl, timer, visibility });
    // Scheduler awal pasang timer, tapi tab tersembunyi: tick pertama tidak memfetch.
    await timer.advance(120_000);
    expect(fetcher.calls).toEqual([]);
    visibility.set(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher.calls.length).toBe(1);
    expect(applied).toEqual([payloadOf({})]);
  });

  it("regresi angka mandeg: tiap perubahan isi respons sampai ke apply", async () => {
    const timer = makeTimer();
    const visibility = makeVisibility();
    const fetcher = makeFetch([
      { status: 200, body: payloadOf({ votes_count: 27 }) },
      { status: 200, body: payloadOf({ votes_count: 28 }) },
      { status: 200, body: payloadOf({ votes_count: 29, eligible_count: 398 }) },
    ]);
    const applied: TurnoutPayload[] = [];
    startTurnoutPoller({ apply: (d) => applied.push(d), baseIntervalMs: () => OPEN_MS, initialStage: "open", fetchImpl: fetcher.impl, timer, visibility });
    await timer.advance(90_000);
    expect(applied.slice(0, 3).map((d) => d.votes_count)).toEqual([27, 28, 29]);
    expect(applied[2]).toMatchObject({ eligible_count: 398 });
  });

  it("stop() menghentikan segalanya", async () => {
    const timer = makeTimer();
    const visibility = makeVisibility();
    const fetcher = makeFetch();
    const poller = startTurnoutPoller({ apply: () => {}, baseIntervalMs: () => OPEN_MS, initialStage: "open", fetchImpl: fetcher.impl, timer, visibility });
    poller.stop();
    expect(poller.pendingDelayMs()).toBeNull();
    const calls = fetcher.calls.length;
    await timer.advance(120_000);
    expect(fetcher.calls.length).toBe(calls);
  });
});
