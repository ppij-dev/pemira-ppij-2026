/**
 * Klasifikasi tahap masuk yang gagal dan salinan kartu pemulihan di /akun
 * (perubahan recover-login-session). Murni dan tanpa I/O agar mudah diuji:
 * tidak ada state, kode otorisasi, token, nilai cookie, atau data pribadi
 * yang masuk ke kategori, kode bantuan, maupun salinan.
 */
import type { AuthFailureCategory, AuthStageData } from "./session";

export type RecoveryStage =
  | { kind: "canceled" }
  | { kind: "incomplete" }
  | { kind: "session_unavailable" };

/**
 * /akun memetakan penanda tahap (dari cookie server) ke tepat satu kartu
 * pemulihan. Tanpa penanda bukan kegagalan: pengunjung biasa mendapat kartu
 * "Belum masuk" yang biasa.
 */
export function classifyRecovery(stage: AuthStageData | null): RecoveryStage | null {
  if (!stage) return null;
  if (stage.stage === "ok") return { kind: "session_unavailable" };
  if (stage.category === "dibatalkan") return { kind: "canceled" };
  return { kind: "incomplete" };
}

export interface RecoveryCopy {
  title: string;
  body: string;
  retryLabel: string;
}

/** Salinan kartu (Bahasa Indonesia) per tahap; bantuan peramban hanya sekunder. */
export function recoveryCopy(stage: RecoveryStage): RecoveryCopy {
  switch (stage.kind) {
    case "canceled":
      return {
        title: "Masuk dibatalkan",
        body: "Proses masuk di One Login tidak selesai. Silakan coba masuk kembali.",
        retryLabel: "Coba masuk lagi",
      };
    case "incomplete":
      return {
        title: "Masuk belum selesai",
        body: "Kami belum bisa menyelesaikan masuk lewat PPIJ One Login. Silakan coba lagi.",
        retryLabel: "Coba masuk lagi",
      };
    case "session_unavailable":
      return {
        title: "Sesi masuk belum aktif",
        body: "Kami belum bisa membaca sesi masuk di peramban ini.",
        retryLabel: "Coba masuk lagi",
      };
  }
}

/**
 * Kode bantuan pendek dan stabil per (kategori, jam UTC) untuk dilaporkan ke
 * panitia bila kegagalan berulang. Deterministik dari kategori + kunci master;
 * tidak memuat data pribadi maupun detail internal.
 */
export async function helpCode(
  category: AuthFailureCategory | null,
  masterKey: string,
  now: number,
): Promise<string> {
  const bucket = Math.floor(now / 3600);
  const material = `${category ?? "ok"}|${bucket}|${masterKey}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const bytes = new Uint8Array(digest).slice(0, 6);
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}
