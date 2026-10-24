export function formatKomsatPath(path: string): string {
  const name = path.split("/").filter(Boolean).at(-1) || path;
  return name.replace(/[-_]+/g, " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
