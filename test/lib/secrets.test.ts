import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../../src/server/lib/secrets";

function masterKey(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw));
}

describe("secret helpers (AES-256-GCM)", () => {
  it("mengenkripsi dan mendekripsi kembali (round-trip)", async () => {
    const key = masterKey();
    const stored = await encryptSecret(key, "kunci-api-12345");
    expect(stored).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain("kunci-api-12345");
    expect(await decryptSecret(key, stored)).toBe("kunci-api-12345");
  });

  it("memakai IV acak sehingga dua enkripsi berbeda", async () => {
    const key = masterKey();
    const a = await encryptSecret(key, "rahasia-sama");
    const b = await encryptSecret(key, "rahasia-sama");
    expect(a).not.toBe(b);
  });

  it("menolak ciphertext yang diubah", async () => {
    const key = masterKey();
    const stored = await encryptSecret(key, "rahasia");
    const [version, iv, ct] = stored.split(":");
    const bytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    const tampered = `${version}:${iv}:${btoa(String.fromCharCode(...bytes))}`;
    await expect(decryptSecret(key, tampered)).rejects.toThrow();
  });

  it("menolak kunci yang salah", async () => {
    const stored = await encryptSecret(masterKey(), "rahasia");
    await expect(decryptSecret(masterKey(), stored)).rejects.toThrow();
  });

  it("menolak kunci yang bukan base64 dari 32 byte", async () => {
    await expect(encryptSecret(btoa("terlalu-pendek"), "rahasia")).rejects.toThrow();
    await expect(decryptSecret(btoa("terlalu-pendek"), "v1:AAAA:BBBB")).rejects.toThrow();
  });

  it("menolak format versi yang tidak dikenal", async () => {
    const key = masterKey();
    await expect(decryptSecret(key, "v9:AAAA:BBBB")).rejects.toThrow();
    await expect(decryptSecret(key, "bukan-format")).rejects.toThrow();
  });
});
