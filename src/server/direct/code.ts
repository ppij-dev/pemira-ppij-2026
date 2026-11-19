/**
 * Kode tautan Undangan Langsung: 128 bit acak sebagai 26 karakter Crockford
 * Base32 (huruf besar tanpa I/L/O/U), alfabet yang sama dengan kode bukti.
 * Baris menyimpan hash SHA-256 untuk pencarian dan token tersegel
 * APP_MASTER_KEY agar Admin Voting dapat menyalin tautan lagi sampai tautan
 * dipakai atau dibatalkan (keputusan pemilik 2026-11-19). `reference` 6
 * karakter bukan kredensial: hanya nama baris di tabel dan di audit log.
 */
import { decryptSecret, encryptSecret } from "../lib/secrets";
import { CROCKFORD_ALPHABET, hashReceipt, normalizeReceiptCode } from "../voting/receipt";

export const LINK_TOKEN_BYTES = 16;
export const LINK_TOKEN_LENGTH = 26;
export const LINK_REFERENCE_LENGTH = 6;

/** Encode byte apa pun ke Crockford Base32 (tanpa padding), huruf besar. */
export function encodeCrockford(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) >>> 0;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** Kode tautan kanonik 26 karakter, tanpa pemisah; hanya untuk respons. */
export function generateLinkCode(): string {
  return encodeCrockford(crypto.getRandomValues(new Uint8Array(LINK_TOKEN_BYTES)));
}

/** Normalisasi kode dari URL; null bila panjangnya bukan kode tautan. */
export function normalizeLinkCode(input: string): string | null {
  const normalized = normalizeReceiptCode(input);
  return normalized.length === LINK_TOKEN_LENGTH ? normalized : null;
}

/** SHA-256 dari kode ternormalisasi; satu-satunya cara tautan dicari. */
export function linkTokenHash(code: string): Promise<string> {
  return hashReceipt(code);
}

export function sealLinkToken(masterKey: string, code: string): Promise<string> {
  return encryptSecret(masterKey, code);
}

/** Buka token tersegel; null bila rusak atau kuncinya tidak cocok (tidak melempar). */
export async function openLinkToken(masterKey: string, sealed: string): Promise<string | null> {
  try {
    return await decryptSecret(masterKey, sealed);
  } catch {
    return null;
  }
}

/** Kode tampil 6 karakter yang belum dipakai, dari alfabet yang sama. */
export function generateReference(existing: ReadonlySet<string>): string {
  for (;;) {
    const candidate = encodeCrockford(crypto.getRandomValues(new Uint8Array(4))).slice(0, LINK_REFERENCE_LENGTH);
    if (candidate.length === LINK_REFERENCE_LENGTH && !existing.has(candidate)) return candidate;
  }
}

/** URL publik lengkap untuk satu kode. */
export function publicLink(baseUrl: string, code: string): string {
  return new URL(`/undangan/${code}`, baseUrl).href;
}
