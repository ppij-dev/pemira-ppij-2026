import type { D1Database } from "@cloudflare/workers-types";
import type { UnitNames } from "../../lib/formatKomsat";

/**
 * Nama resmi unit dari tabel units (hasil sinkronisasi Service API
 * `organisasi.dasar`). Halaman memakai peta ini lewat `unitPathLabel` agar
 * nama komsat/korda berasal dari portal, bukan dipecah dari jalur.
 * Tabel kosong (belum pernah sinkron) mengembalikan peta kosong tanpa gagal.
 */
export async function loadUnitNames(db: D1Database): Promise<UnitNames> {
  try {
    const { results } = await db.prepare("SELECT path, name FROM units").all<{ path: string; name: string }>();
    return Object.fromEntries(results.map((row) => [row.path, row.name]));
  } catch {
    return {};
  }
}
