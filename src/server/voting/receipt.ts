/**
 * Kode bukti suara: 128 bit acak yang dikodekan sebagai 26 karakter
 * Crockford Base32 (alfabet 0-9, A-Z tanpa I, L, O, U). Karakter ke-26
 * hanya memakai 3 bit terakhir (nilai 0-7). Hanya SHA-256 dari kode
 * ternormalisasi yang disimpan di D1; kode mentah tidak pernah disimpan.
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

export const RECEIPT_CODE_LENGTH = 26;
export const RECEIPT_BYTES = 16;

/** Normalisasi kode bukti: hilangkan pemisah, uppercase, petakan alias. */
export function normalizeReceiptCode(input: string): string {
  return input
    .replace(/[\s\-_.]+/g, "")
    .toUpperCase()
    .replace(/[O]/g, "0")
    .replace(/[IL]/g, "1");
}

/** Encode 16 byte (128 bit) menjadi 26 karakter Crockford Base32. */
export function encodeReceipt(bytes: Uint8Array): string {
  if (bytes.length !== RECEIPT_BYTES) throw new Error("Kode bukti harus 16 byte");
  let out = "";
  for (let i = 0; i < 25; i++) {
    const bitStart = i * 5;
    const byteIndex = bitStart >> 3;
    const bitOffset = bitStart & 7;
    const word = (bytes[byteIndex]! << 8) | (byteIndex + 1 < 16 ? bytes[byteIndex + 1]! : 0);
    out += ALPHABET[(word >> (11 - bitOffset)) & 0x1f];
  }
  // Karakter ke-26: 3 bit terakhir (bit 125..127 = 3 bit rendah byte 15)
  out += ALPHABET[bytes[15]! & 0x07];
  return out;
}

/** Decode 26 karakter Crockford Base32 kembali ke 16 byte. */
export function decodeReceipt(code: string): Uint8Array {
  const normalized = normalizeReceiptCode(code);
  if (normalized.length !== RECEIPT_CODE_LENGTH) throw new Error("Panjang kode bukti tidak valid");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 25; i++) {
    const val = DECODE_MAP[normalized[i]!];
    if (val === undefined || val > 31) throw new Error("Karakter kode bukti tidak valid");
    const bitStart = i * 5;
    const byteIndex = bitStart >> 3;
    const bitOffset = bitStart & 7;
    bytes[byteIndex]! |= (val << (11 - bitOffset)) >> 8;
    if (byteIndex + 1 < 16) bytes[byteIndex + 1]! |= (val << (11 - bitOffset)) & 0xff;
  }
  const lastVal = DECODE_MAP[normalized[25]!];
  if (lastVal === undefined || lastVal > 7) throw new Error("Karakter terakhir kode bukti tidak valid");
  bytes[15]! |= lastVal & 0x07;
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
  const code = encodeReceipt(bytes);
  const hash = await hashReceipt(code);
  return { code, hash };
}
