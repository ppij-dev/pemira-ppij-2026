/**
 * Polling statistik /api/turnout (satu-satunya polling di situs; keputusan
 * owner 2026-11-19/204). Aturan perilaku:
 *   - Selalu berjalan selama halaman terlihat; berhenti hanya saat tab
 *     tersembunyi dan langsung men-polling lagi saat tab terlihat kembali.
 *   - `cache: "no-store"` pada setiap permintaan: angka tidak boleh diambil
 *     dari cache peramban/CDN.
 *   - Respons non-OK (mis. 429 rate limit) dan galat jaringan tidak menghentikan
 *     polling: mundur bertahap (2x, 4x, ... sampai batas atas) lalu lanjut.
 *   - Setelah respons sukses, jeda kembali ke interval dasar tahap terkini.
 *
 * Port (fetch, timer, document) dapat disuntik supaya perilakunya dapat diuji
 * di vitest tanpa DOM dan tanpa jaringan sungguhan.
 */

export interface TurnoutPayload {
  stage: string;
  eligible_count: number;
  votes_count: number;
  updated_at: string;
}

/** Port timer minimal supaya uji dapat menggerakkan waktu secara manual. */
export interface TimerPort {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Bagian document yang dipakai polling: status dan transisi visibilitas. */
export interface VisibilityPort {
  hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface TurnoutPollerOptions {
  /** Dipanggil dengan isi JSON setiap respons 2xx yang sah. */
  apply(payload: TurnoutPayload): void;
  /** Interval dasar (ms) menurut tahap terkini; mis. `open` memakai 15 s. */
  baseIntervalMs(stage: string | undefined): number;
  /** Tahap awal dari render server (data-stage), agar jeda pertama tepat. */
  initialStage?: string;
  url?: string;
  fetchImpl?: typeof fetch;
  timer?: TimerPort;
  visibility?: VisibilityPort;
  /** Batas atas jeda mundur (ms); default 60 s. */
  maxBackoffMs?: number;
}

export interface TurnoutPollerHandle {
  stop(): void;
  /** Jeda permintaan berikutnya (ms), atau null saat tab tersembunyi/berhenti. */
  pendingDelayMs(): number | null;
  /** Jumlah kegagalan beruntun sejak sukses terakhir (0 = normal). */
  failures(): number;
}

const JITTER_MS = 2000;

export function startTurnoutPoller(options: TurnoutPollerOptions): TurnoutPollerHandle {
  const url = options.url ?? "/api/turnout";
  const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timer: TimerPort = options.timer ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as number),
  };
  const maxBackoffMs = options.maxBackoffMs ?? 60_000;

  let stage: string | undefined = options.initialStage;
  let handle: unknown = null;
  let pending = 0;
  let stopped = false;
  let inFlight = false;
  let failureCount = 0;

  const clearPending = (): void => {
    if (handle !== null) {
      timer.clear(handle);
      handle = null;
    }
    pending = 0;
  };

  const schedule = (delayMs: number): void => {
    clearPending();
    if (stopped) return;
    pending = delayMs;
    handle = timer.set(() => {
      handle = null;
      pending = 0;
      void tick();
    }, delayMs);
  };

  const onSuccess = (payload: TurnoutPayload): void => {
    failureCount = 0;
    stage = payload.stage;
    options.apply(payload);
    schedule(options.baseIntervalMs(stage));
  };

  const onFailure = (): void => {
    // Mundur tapi terus berjalan: 2x, 4x, ... sampai batas atas, lalu tetap
    // 1x batas atas sampai ada sukses. Polling tidak pernah berhenti sendiri.
    failureCount += 1;
    const backoff = Math.min(options.baseIntervalMs(stage) * 2 ** failureCount, maxBackoffMs);
    schedule(backoff + Math.floor(Math.random() * JITTER_MS));
  };

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;
    // Tab tersembunyi (termasuk halaman yang dibuka di latar): tidak men-polling
    // dan tidak menjadwalkan; kembali terlihat memicu polling segera.
    if (options.visibility?.hidden) return;
    inFlight = true;
    try {
      const response = await doFetch(url, { cache: "no-store" });
      if (!response.ok) {
        onFailure();
        return;
      }
      const payload = (await response.json()) as TurnoutPayload;
      if (typeof payload?.votes_count !== "number" || typeof payload?.eligible_count !== "number") {
        onFailure();
        return;
      }
      onSuccess(payload);
    } catch {
      onFailure();
    } finally {
      inFlight = false;
    }
  };

  // Tab tersembunyi: hentikan sementara; terlihat lagi: polling segera.
  if (options.visibility) {
    options.visibility.addEventListener("visibilitychange", () => {
      if (stopped) return;
      if (options.visibility!.hidden) {
        clearPending();
      } else {
        void tick();
      }
    });
  }

  schedule(options.baseIntervalMs(stage) + Math.floor(Math.random() * JITTER_MS));

  return {
    stop(): void {
      stopped = true;
      clearPending();
    },
    pendingDelayMs: () => (stopped || options.visibility?.hidden ? null : pending),
    failures: () => failureCount,
  };
}
