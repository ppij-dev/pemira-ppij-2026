/** Nama resmi unit per jalur, dari tabel units hasil sinkronisasi Service API. */
export type UnitNames = Record<string, string>;

function titleCasePart(part: string): string {
  return part.replace(/[-_]+/g, " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function formatKomsatPath(path: string): string {
  const name = path.split("/").filter(Boolean).at(-1) || path;
  return titleCasePart(name);
}

/** Jalur unit lengkap sebagai nama tampilan: /ppij/kansai/okayama → Kansai · Okayama. */
export function formatUnitPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .slice(1)
    .map(titleCasePart)
    .join(" · ");
}

/**
 * Nama resmi unit paling dalam pada jalur (mis. komsatnya sendiri) dari
 * tabel units; pecahan jalur dipakai hanya bila unit belum tersinkron.
 */
export function unitNameOf(path: string, names: UnitNames = {}): string {
  return names[path] ?? formatKomsatPath(path);
}

/**
 * Nama tampilan jalur unit memakai nama resmi portal (`units.name`) untuk
 * setiap ruas jalur; ruas yang belum tersinkron dipecah dari jalurnya. Akar
 * nasional `/ppij` dibuang seperti `formatUnitPath`, sehingga
 * /ppij/kansai/okayama → "Kansai · PPI Okayama".
 */
export function unitPathLabel(path: string, names: UnitNames = {}): string {
  const parts = path.split("/").filter(Boolean);
  return parts
    .slice(1)
    .map((part, index) => names[`/${parts.slice(0, index + 2).join("/")}`] ?? titleCasePart(part))
    .join(" · ");
}
