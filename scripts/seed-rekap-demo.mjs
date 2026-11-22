#!/usr/bin/env node
/**
 * Seed demo untuk Rekapitulasi Suara (keputusan owner Q232–Q234, 2026-11-22).
 *
 * Deterministik dan dapat diulang: data yang sama setiap dijalankan, untuk D1
 * lokal atau basis data pratinjau terpisah. Isi: satu pemilihan mode kandidat
 * tunggal yang sudah Ditutup tetapi belum direkap, ~400 anggota dalam beberapa
 * korda/komsat (satu korda kosong), partisipasi ~60% dengan campuran
 * Setuju/Tidak Setuju, dan 10 tautan undangan (6 dipakai, 2 belum, 2 batal).
 *
 * Skrip mencetak angka harapan dari kalkulator rujukan yang sama aritmetikanya
 * dengan test, sehingga angka halaman bisa diperiksa manusia. Menolak berjalan
 * pada nama basis data produksi `pemira-ppij-2026`.
 *
 * Pakai:
 *   node scripts/seed-rekap-demo.mjs                     # D1 lokal (wrangler dev)
 *   node scripts/seed-rekap-demo.mjs --database <nama>   # basis data pratinjau
 *   node scripts/seed-rekap-demo.mjs --dry-run           # cetak SQL tanpa menjalankan
 *
 * Setelah seed, terapkan skema bila basis datanya masih kosong:
 *   npx wrangler d1 migrations apply DB --local   (atau --remote --database <nama>)
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

const PRODUCTION_DATABASE = "pemira-ppij-2026";
const WRANGLER_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
  let database = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--database" || arg === "-d") {
      i++;
      if (i >= argv.length) throw new Error("Pemakaian: node scripts/seed-rekap-demo.mjs [--database <nama>] [--dry-run]");
      database = argv[i].trim();
    } else if (arg.startsWith("--database=")) database = arg.slice("--database=".length).trim();
    else throw new Error(`Argumen tidak dikenal: ${arg}. Pemakaian: node scripts/seed-rekap-demo.mjs [--database <nama>] [--dry-run]`);
  }
  if (database === PRODUCTION_DATABASE) {
    throw new Error(`Menolak berjalan terhadap basis data produksi "${PRODUCTION_DATABASE}". Pakai D1 lokal atau basis data pratinjau terpisah.`);
  }
  return { database, dryRun };
}

/** PRNG deterministik (mulberry32, seed tetap) supaya seed dapat diulang. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Susunan data demo yang sama dengan yang dibaca kalkulator rujukan di bawah. */
function buildDemo() {
  const rand = mulberry32(20261122);
  const units = [];
  // Empat korda; Osaka sengaja kosong (keputusan owner: satu korda tanpa pemilih).
  const kordas = [
    { path: "/ppij/okayama", name: "Korda Okayama", komsat: ["komsat-a", "komsat-b"] },
    { path: "/ppij/tokyo", name: "Korda Tokyo", komsat: ["komsat-a", "komsat-b", "komsat-c"] },
    { path: "/ppij/kobe", name: "Korda Kobe", komsat: ["komsat-a"] },
    { path: "/ppij/osaka", name: "Korda Osaka", komsat: [] },
  ];
  units.push({ path: "/ppij", name: "PPI Jepang", parent: "", type: "national" });
  for (const korda of kordas) {
    units.push({ path: korda.path, name: korda.name, parent: "/ppij", type: "korda" });
    for (const komsat of korda.komsat) {
      units.push({ path: `${korda.path}/${komsat}`, name: `Komsat ${komsat.slice(7).toUpperCase()} ${korda.name.replace("Korda ", "")}`, parent: korda.path, type: "komsat" });
    }
  }

  // ~400 anggota roll, tersebar dengan bobot berbeda; Osaka kosong.
  const weights = [
    ["/ppij/okayama/komsat-a", 70],
    ["/ppij/okayama/komsat-b", 50],
    ["/ppij/tokyo/komsat-a", 90],
    ["/ppij/tokyo/komsat-b", 60],
    ["/ppij/tokyo/komsat-c", 40],
    ["/ppij/kobe/komsat-a", 80],
  ];
  const members = [];
  let seq = 0;
  for (const [path, count] of weights) {
    for (let i = 0; i < count; i++) {
      seq += 1;
      members.push({
        member_id: `anggota-${String(seq).padStart(3, "0")}`,
        name: `Anggota ${String(seq).padStart(3, "0")}`,
        member_number: `KARTU-${String(seq).padStart(4, "0")}`,
        komsat_path: path,
      });
    }
  }

  // ~60% memilih, campuran Setuju/Tidak Setuju (tanpa pernah per orang di audit).
  const votes = [];
  for (const member of members) {
    if (rand() < 0.6) {
      votes.push({ member: member.member_id, name: member.name, path: member.komsat_path, choice: rand() < 0.58 ? "setuju" : "tidak_setuju" });
    }
  }

  // 10 tautan: 6 dipakai (tamu memilih di komsat pilihannya), 2 belum, 2 batal.
  const inviteTargets = weights.map(([path]) => path);
  const invites = [];
  for (let i = 1; i <= 10; i++) {
    const reference = `DM${String(i).padStart(4, "0")}`;
    if (i <= 6) invites.push({ reference, used: true, komsat: inviteTargets[i % inviteTargets.length], choice: i % 2 === 1 ? "setuju" : "tidak_setuju", guest: `Tamu Undangan ${i}` });
    else if (i <= 8) invites.push({ reference, used: false, cancelled: false });
    else invites.push({ reference, used: false, cancelled: true });
  }

  return { units, members, votes, invites, closedAt: "2026-11-22T13:00:00Z", openedAt: "2026-11-20T09:00:00Z" };
}

/**
 * Kalkulator rujukan (SQL polos atas tabel mentah, aritmetika sama dengan test
 * recap-export): menghitung ulang setiap angka Ringkasan dari data demo.
 */
export function referenceCalculator({ units, members, votes, invites, closedAt }) {
  const unitNames = new Map(units.map((u) => [u.path, u.name]));
  const regionKey = (path) => {
    const parts = path.split("/").filter(Boolean);
    return parts.length >= 2 ? `/${parts[0]}/${parts[1]}` : `/${parts[0]}`;
  };
  const roll = members.length;
  const active = invites.filter((i) => !i.cancelled);
  const used = active.filter((i) => i.used);
  const unused = active.filter((i) => !i.used);
  const hakPilih = roll + active.length;
  const participation = votes.length + used.length;
  const setuju = votes.filter((v) => v.choice === "setuju").length + used.filter((i) => i.choice === "setuju").length;
  const tidak = votes.filter((v) => v.choice === "tidak_setuju").length + used.filter((i) => i.choice === "tidak_setuju").length;
  const abstain = hakPilih - participation;
  const pct = (n) => Math.round((n / hakPilih) * 1000) / 10;
  const kordaRows = new Map();
  for (const unit of units.filter((u) => u.type === "korda")) kordaRows.set(unit.path, { name: unit.name, hak: 0, used: 0 });
  const komsatRows = new Map();
  for (const unit of units.filter((u) => u.type === "komsat")) komsatRows.set(unit.path, { korda: unitNames.get(unit.parent), name: unit.name, hak: 0, used: 0 });
  const bump = (map, path, key, delta) => {
    const target = map.get(path);
    if (target) target[key] += delta;
    return Boolean(target);
  };
  const votesByPath = new Map();
  for (const vote of votes) votesByPath.set(vote.path, (votesByPath.get(vote.path) ?? 0) + 1);
  // Hak pilih per wilayah dari roll (suku roll), ditambah tautan terpakai di bawah.
  for (const member of members) bump(kordaRows, regionKey(member.komsat_path), "hak", 1);
  for (const member of members) bump(komsatRows, member.komsat_path, "hak", 1);
  for (const invite of used) {
    bump(kordaRows, regionKey(invite.komsat), "hak", 1);
    bump(kordaRows, regionKey(invite.komsat), "used", 1);
    bump(komsatRows, invite.komsat, "hak", 1);
    bump(komsatRows, invite.komsat, "used", 1);
  }
  for (const [path, n] of votesByPath) {
    bump(kordaRows, regionKey(path), "used", n);
    bump(komsatRows, path, "used", n);
  }
  if (unused.length > 0) {
    kordaRows.set("_tautan", { name: "Tautan undangan belum dipakai", hak: unused.length, used: 0, remainder: true });
    komsatRows.set("_tautan", { korda: "—", name: "Tautan undangan belum dipakai", hak: unused.length, used: 0, remainder: true });
  }
  const share = (row) => (row.hak > 0 && !row.remainder ? Math.round((row.used / row.hak) * 1000) / 10 : null);
  return {
    closedAt,
    total_dpt: roll,
    invites: { created: invites.length, cancelled: invites.filter((i) => i.cancelled).length, used: used.length, unused: unused.length },
    dpt_final: hakPilih,
    votes_used: participation,
    setuju,
    tidak_setuju: tidak,
    abstain,
    setuju_pct: pct(setuju),
    tidak_setuju_pct: pct(tidak),
    abstain_pct: pct(abstain),
    korda: [...kordaRows.values()].map((row) => ({ ...row, pct: share(row) })),
    komsat: [...komsatRows.values()].map((row) => ({ ...row, pct: share(row) })),
  };
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Kumpulan pernyataan SQL deterministik untuk seed demo. */
export function buildSeedStatements(demo) {
  const statements = [];
  statements.push("DELETE FROM ballots; DELETE FROM participation; DELETE FROM direct_invitations; DELETE FROM voters; DELETE FROM candidates; DELETE FROM units; DELETE FROM audit_log; DELETE FROM elections;");
  statements.push(`INSERT INTO elections (id, title, description, status_lock, opens_at, closes_at, closed_early_at, allow_admin_voting, single_candidate_mode, live_voter_roll, frozen_hak_pilih, frozen_at) VALUES (1, ${sql("Pemira PPIJ 2026 (Demo Rekapitulasi)")}, ${sql("Data demo untuk halaman Rekapitulasi")}, 'locked', ${sql(demo.openedAt)}, ${sql(demo.closedAt)}, ${sql(demo.closedAt)}, 1, 1, 0, ${demo.members.length}, ${sql(demo.closedAt)});`);
  for (const unit of demo.units) {
    statements.push(`INSERT INTO units (path, name, parent_path, type) VALUES (${sql(unit.path)}, ${sql(unit.name)}, ${sql(unit.parent)}, ${sql(unit.type)});`);
  }
  statements.push(`INSERT INTO candidates (id, member_id, number, name, nickname, komsat_path, color, content_html) VALUES (1, 'cand-demo', 1, 'Kandidat Demo', 'Demo', ${sql("/ppij/okayama/komsat-a")}, '#c8102e', '');`);
  for (const member of demo.members) {
    statements.push(`INSERT INTO voters (member_id, name, nickname, komsat_path, status, synced_at, can_vote, member_number) VALUES (${sql(member.member_id)}, ${sql(member.name)}, '', ${sql(member.komsat_path)}, 'ACTIVE', ${sql(demo.openedAt)}, 1, ${sql(member.member_number)});`);
  }
  let ballot = 0;
  for (const vote of demo.votes) {
    ballot += 1;
    const receipt = `hash-demo-${String(ballot).padStart(4, "0")}`;
    statements.push(`INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (1, ${sql(vote.member)}, ${sql(vote.name)}, ${sql(demo.closedAt)}, 0);`);
    statements.push(`INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test, choice) VALUES (${sql(`ballot-demo-${ballot}`)}, 1, 1, ${sql(vote.path)}, ${sql(receipt)}, 0, ${sql(vote.choice)});`);
  }
  for (const [i, invite] of demo.invites.entries()) {
    const tokenHash = `hash-invite-demo-${i + 1}`;
    statements.push(`INSERT INTO direct_invitations (reference, token_hash, token_enc, created_at, created_by, created_by_name, komsat_path, guest_name, used_at, cancelled_at) VALUES (${sql(invite.reference)}, ${sql(tokenHash)}, 'v1:demo-sealed', ${sql(demo.openedAt)}, 'admin-demo', 'Admin Demo', ${sql(invite.used ? invite.komsat : null)}, ${sql(invite.guest ?? null)}, ${sql(invite.used ? demo.closedAt : null)}, ${sql(invite.cancelled ? demo.openedAt : null)});`);
    if (invite.used) {
      ballot += 1;
      statements.push(`INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (1, ${sql(`undangan:${invite.reference}`)}, ${sql(invite.guest)}, ${sql(demo.closedAt)}, 0);`);
      statements.push(`INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test, choice) VALUES (${sql(`ballot-demo-${ballot}`)}, 1, 1, ${sql(invite.komsat)}, ${sql(`hash-demo-invite-${i + 1}`)}, 0, ${sql(invite.choice)});`);
    }
  }
  statements.push(`INSERT INTO system_config (key, value) VALUES ('initialized', '1'), ('site_scope', '/ppij'), ('site_name', 'Pemira PPIJ 2026 (Demo)'), ('site_base_url', 'http://127.0.0.1:8787') ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
  statements.push(`INSERT OR IGNORE INTO admin_voting (member_id, name, is_technical, created_at) VALUES ('admin-demo', 'Admin Demo', 1, ${sql(demo.openedAt)});`);
  return statements;
}

function runWrangler(args, database) {
  // Tanpa --persist-to: memakai .wrangler/state yang sama dengan
  // `wrangler d1 migrations apply` dan `wrangler dev` di direktori kerja ini.
  return execFileAsync("npx", ["wrangler", "d1", "execute", database || "DB", ...args, "--local"], { timeout: WRANGLER_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
}

function printExpected(expected) {
  console.log("\nAngka harapan (kalkulator rujukan) untuk diperbandingkan dengan halaman Rekapitulasi:");
  console.log(`  DPT final (Hak pilih hasil) : ${expected.dpt_final} (roll ${expected.total_dpt} + tautan aktif ${expected.invites.created - expected.invites.cancelled})`);
  console.log(`  Tautan undangan             : ${expected.invites.created} dibuat · ${expected.invites.used} dipakai · ${expected.invites.unused} belum · ${expected.invites.cancelled} batal`);
  console.log(`  Total suara digunakan       : ${expected.votes_used}`);
  console.log(`  Setuju                      : ${expected.setuju} (${expected.setuju_pct}%)`);
  console.log(`  Tidak Setuju                : ${expected.tidak_setuju} (${expected.tidak_setuju_pct}%)`);
  console.log(`  Abstain                     : ${expected.abstain} (${expected.abstain_pct}%)`);
  console.log(`  Jumlah: Setuju + Tidak Setuju + Abstain = ${expected.setuju + expected.tidak_setuju + expected.abstain}`);
  console.log("\nPer korda (Hak pilih · Suara digunakan · Partisipasi):");
  for (const row of expected.korda) console.log(`  ${row.name.padEnd(34)} ${String(row.hak).padStart(4)} · ${String(row.used).padStart(4)} · ${row.pct === null ? "—" : row.pct + "%"}`);
  console.log("\nPer komsat (Korda · Komsat · Hak pilih · Suara digunakan · Partisipasi):");
  for (const row of expected.komsat) console.log(`  ${String(row.korda).padEnd(16)} ${row.name.padEnd(28)} ${String(row.hak).padStart(4)} · ${String(row.used).padStart(4)} · ${row.pct === null ? "—" : row.pct + "%"}`);
}

async function main() {
  const { database, dryRun } = parseArgs(process.argv.slice(2));
  const demo = buildDemo();
  const expected = referenceCalculator(demo);
  const statements = buildSeedStatements(demo);

  console.log("Seed demo Rekapitulasi Suara");
  console.log(`  Basis data : ${database || "DB (lokal)"}`);
  console.log(`  Anggota    : ${demo.members.length} (roll beku ${demo.members.length})`);
  console.log(`  Suara roll : ${demo.votes.length} · tautan dipakai: ${demo.invites.filter((i) => i.used).length}`);
  printExpected(expected);

  if (dryRun) {
    const dir = await mkdtemp(join(tmpdir(), "rekap-demo-"));
    const file = join(dir, "seed.sql");
    await writeFile(file, statements.join("\n") + "\n");
    console.log(`\nMode --dry-run: ${statements.length} pernyataan SQL ditulis ke ${file}`);
    console.log("Jalankan dengan: npx wrangler d1 execute DB --local --file " + file);
    return;
  }

  // Jalankan per batch kecil: satu berkas besar melebihi batas perintah D1.
  const BATCH = 120;
  const workDir = await mkdtemp(join(tmpdir(), "rekap-demo-"));
  try {
    for (let i = 0; i < statements.length; i += BATCH) {
      const file = join(workDir, `batch-${i}.sql`);
      await writeFile(file, statements.slice(i, i + BATCH).join("\n") + "\n");
      await runWrangler(["--file", file], database);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  console.log("\nSeeded.");
  console.log("\nLangkah berikutnya: masuk sebagai Admin Voting (bootstrap 'admin-demo' bila perlu), buka /admin/rekap, jalankan Rekapitulasi Suara, lalu Unduh Excel.");
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("seed-rekap-demo.mjs");
if (isDirectRun) {
  main().catch((error) => {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
