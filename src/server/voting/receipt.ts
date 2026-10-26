/**
 * Kode bukti suara: 80 bit acak dikodekan sebagai 16 karakter Crockford
 * Base32 (0-9, A-Z tanpa I, L, O, U — besar semua, mudah diketik), ditampilkan
 * berkelompok 4-4-4-4. Kode lama 26 karakter tetap dapat diperiksa.
 * Hanya SHA-256 dari kode ternormalisasi (tanpa
 * pemisah, alias dipetakan) yang disimpan di D1; kode mentah tidak pernah
 * disimpan.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DECODE_MAP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) DECODE_MAP[ALPHABET[i]!] = i;
// Crockford aliases
DECODE_MAP["o"] = 0;
DECODE_MAP["O"] = 0;
DECODE_MAP["i"] = 1;
DECODE_MAP["I"] = 1;
DECODE_MAP["l"] = 1;
DECODE_MAP["L"] = 1;

export const RECEIPT_CODE_LENGTH = 16;
export const RECEIPT_BYTES = 10;
const LEGACY_CODE_LENGTH = 26;
const LEGACY_BYTES = 16;

/** Normalisasi kode bukti: hilangkan pemisah, uppercase, petakan alias. */
export function normalizeReceiptCode(input: string): string {
  return input
    .replace(/[\s\-_.]+/g, "")
    .toUpperCase()
    .replace(/[O]/g, "0")
    .replace(/[IL]/g, "1");
}

/** Kelompokkan per empat karakter; format lama tidak dipotong. */
export function formatReceiptCode(canonical: string): string {
  return canonical.replace(/(.{4})(?=.)/g, "$1-");
}

/** Encode 10 byte (80 bit) menjadi 16 karakter Crockford Base32. */
export function encodeReceipt(bytes: Uint8Array): string {
  if (bytes.length !== RECEIPT_BYTES) throw new Error("Kode bukti harus 10 byte");
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) >>> 0;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** Decode kode baru 16 karakter atau kode lama 26 karakter. */
export function decodeReceipt(code: string): Uint8Array {
  const normalized = normalizeReceiptCode(code);
  const byteLength = normalized.length === RECEIPT_CODE_LENGTH ? RECEIPT_BYTES
    : normalized.length === LEGACY_CODE_LENGTH ? LEGACY_BYTES : null;
  if (byteLength === null) throw new Error("Panjang kode bukti tidak valid");
  const bytes = new Uint8Array(byteLength);
  let buffer = 0;
  let bits = 0;
  let byteIndex = 0;
  for (const ch of normalized) {
    const val = DECODE_MAP[ch];
    if (val === undefined) throw new Error("Karakter kode bukti tidak valid");
    buffer = ((buffer << 5) | val) >>> 0;
    bits += 5;
    if (bits >= 8) {
      bytes[byteIndex++] = (buffer >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) throw new Error("Padding kode bukti tidak valid");
  return bytes;
}

/** SHA-256 hex dari kode bukti ternormalisasi. */
export async function hashReceipt(code: string): Promise<string> {
  const normalized = normalizeReceiptCode(code);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hasilkan kode bukti baru: { code, hash }. Kode mentah hanya untuk respons. */
export async function generateReceipt(): Promise<{ code: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(RECEIPT_BYTES));
  const code = formatReceiptCode(encodeReceipt(bytes));
  const hash = await hashReceipt(code);
  return { code, hash };
}
