/**
 * AES-256-GCM helpers for secrets stored in D1 (APP_MASTER_KEY, base64 of 32 bytes).
 * Stored format: `v1:<iv base64>:<ciphertext+tag base64>`; the 12-byte IV is random
 * per encryption. Plaintext and key material are never logged.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;

async function importKey(masterKeyBase64: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(masterKeyBase64), (c) => c.charCodeAt(0));
  if (raw.length !== KEY_BYTES) {
    throw new Error("APP_MASTER_KEY tidak valid: harus base64 dari 32 byte");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usage);
}

export async function encryptSecret(masterKeyBase64: string, plaintext: string): Promise<string> {
  const key = await importKey(masterKeyBase64, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  return `v1:${ivB64}:${ctB64}`;
}

export async function decryptSecret(masterKeyBase64: string, stored: string): Promise<string> {
  const [version, ivB64, ctB64] = stored.split(":");
  if (version !== "v1" || !ivB64 || !ctB64) {
    throw new Error("Format rahasia tersimpan tidak dikenal");
  }
  const key = await importKey(masterKeyBase64, ["decrypt"]);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0)) },
      key,
      Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0)),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Dekripsi gagal: rahasia rusak atau kunci tidak cocok");
  }
}
