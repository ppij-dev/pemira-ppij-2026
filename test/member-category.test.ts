/**
 * Aturan tampilan dan kelayakan kategori anggota: nilai kategori portal
 * (add-member-category: BIASA / LUAR_BIASA / null) dan nama unit resmi dari
 * tabel units, bukan pecahan jalur.
 */
import { describe, expect, it } from "vitest";
import { memberCategoryLabel, isRegularMember, REGULAR_MEMBER_CATEGORY } from "../src/lib/memberCategory";
import { unitNameOf, unitPathLabel } from "../src/lib/formatKomsat";

describe("kategori anggota (AD/ART)", () => {
  it("memakai nilai BIASA dari portal sebagai Anggota Biasa", () => {
    expect(REGULAR_MEMBER_CATEGORY).toBe("BIASA");
    expect(isRegularMember("BIASA")).toBe(true);
    expect(isRegularMember("biasa")).toBe(true);
    expect(memberCategoryLabel("BIASA")).toBe("Anggota Biasa");
  });

  it("menganggap Luar Biasa dan kategori kosong bukan Anggota Biasa", () => {
    expect(isRegularMember("LUAR_BIASA")).toBe(false);
    expect(isRegularMember(null)).toBe(false);
    expect(isRegularMember(undefined)).toBe(false);
    expect(isRegularMember("")).toBe(false);
    expect(memberCategoryLabel("LUAR_BIASA")).toBe("Anggota Luar Biasa");
    expect(memberCategoryLabel(null)).toBe("Belum ditentukan");
  });
});

describe("nama unit dari portal", () => {
  const names = {
    "/ppij": "PPIJ",
    "/ppij/kansai": "PPI Kansai",
    "/ppij/kansai/okayama": "PPI Okayama",
  };

  it("memakai nama resmi units untuk setiap ruas jalur", () => {
    expect(unitPathLabel("/ppij/kansai/okayama", names)).toBe("PPI Kansai · PPI Okayama");
    expect(unitNameOf("/ppij/kansai/okayama", names)).toBe("PPI Okayama");
  });

  it("memecah jalur hanya bila unit belum tersinkron", () => {
    expect(unitPathLabel("/ppij/kansai/okayama", {})).toBe("Kansai · Okayama");
    expect(unitNameOf("/ppij/kansai/okayama", {})).toBe("Okayama");
    expect(unitPathLabel("/ppij/kansai", { "/ppij/kansai": "PPI Kansai" })).toBe("PPI Kansai");
  });
});
