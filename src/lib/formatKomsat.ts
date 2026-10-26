export function formatKomsatPath(path: string): string {
  const name = path.split("/").filter(Boolean).at(-1) || path;
  return name.replace(/[-_]+/g, " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

/** Jalur unit lengkap sebagai nama tampilan: /ppij/kansai/okayama → Kansai · Okayama. */
export function formatUnitPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .slice(1)
    .map((part) => part.replace(/[-_]+/g, " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()))
    .join(" · ");
}
