import type { D1Database } from "@cloudflare/workers-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNLISTED_MEMBER = "Anggota di luar daftar pemilih";

export interface AuditTargetRow {
  target: string | null;
  komsat_path: string | null;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

/**
 * Nama tampilan untuk `target` dan `komsat_path` entri audit: nama resmi
 * anggota roll beserta nomor kartu, pengurus yang sudah dihapus, kandidat,
 * atau "Pemilihan" untuk id pemilihan. Jalur unit diganti nama resmi portal.
 * UUID anggota yang tidak ada di roll tidak pernah ditampilkan apa adanya.
 */
export async function loadAuditLabels(db: D1Database, rows: AuditTargetRow[]) {
  const memberIds = [...new Set(rows.map((row) => row.target).filter((value): value is string => Boolean(value) && UUID.test(value!)))];
  const candidateIds = [...new Set(rows.map((row) => row.target).filter((value): value is string => Boolean(value) && /^\d+$/.test(value!)).map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
  const paths = [...new Set(rows.map((row) => row.komsat_path).filter((value): value is string => Boolean(value)))];
  const voters = new Map<string, string>();
  const admins = new Map<string, string>();
  const candidates = new Map<string, string>();
  const units = new Map<string, string>();
  const electionTargets = new Set<string>();
  const jobs: Promise<unknown>[] = [];
  if (memberIds.length) {
    jobs.push(db.prepare(`SELECT member_id, name, member_number FROM voters WHERE member_id IN (${placeholders(memberIds.length)})`).bind(...memberIds).all<{ member_id: string; name: string; member_number: string | null }>()
      .then((page) => { for (const row of page.results) voters.set(row.member_id, row.member_number ? `${row.name} · ${row.member_number}` : row.name); }));
    jobs.push(db.prepare(`SELECT member_id, name FROM admin_voting WHERE member_id IN (${placeholders(memberIds.length)})`).bind(...memberIds).all<{ member_id: string; name: string }>()
      .then((page) => { for (const row of page.results) admins.set(row.member_id, row.name); }));
  }
  if (candidateIds.length) {
    jobs.push(db.prepare(`SELECT id, number, name FROM candidates WHERE id IN (${placeholders(candidateIds.length)})`).bind(...candidateIds).all<{ id: number; number: number; name: string }>()
      .then((page) => { for (const row of page.results) candidates.set(String(row.id), `Kandidat nomor ${row.number} · ${row.name}`); }));
  }
  if (paths.length) {
    jobs.push(db.prepare(`SELECT path, name FROM units WHERE path IN (${placeholders(paths.length)})`).bind(...paths).all<{ path: string; name: string }>()
      .then((page) => { for (const row of page.results) units.set(row.path, row.name); }));
  }
  jobs.push(db.prepare("SELECT id FROM elections ORDER BY id LIMIT 1").first<{ id: number }>().then((row) => { if (row) electionTargets.add(String(row.id)); }));
  await Promise.all(jobs);
  const targetLabel = (target: string | null): string | null => {
    if (!target) return null;
    const member = voters.get(target);
    if (member) return member;
    if (admins.has(target)) return admins.get(target)!;
    if (UUID.test(target)) return UNLISTED_MEMBER;
    const candidate = candidates.get(target);
    if (candidate) return candidate;
    if (electionTargets.has(target)) return "Pemilihan";
    return null;
  };
  return {
    targetLabel,
    komsatLabel: (path: string | null): string | null => (path ? units.get(path) ?? null : null),
  };
}
