import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import migrationSql from "../migrations/0001_init.sql?raw";
import unitsMigrationSql from "../migrations/0002_units.sql?raw";
import electionLockMigrationSql from "../migrations/0003_election_lock.sql?raw";
import closingSnapshotMigrationSql from "../migrations/0005_closing_snapshot.sql?raw";
import singleCandidateModeMigrationSql from "../migrations/0011_single_candidate_mode.sql?raw";
import ballotChoiceMigrationSql from "../migrations/0012_ballot_choice.sql?raw";
import ballotAbstainMigrationSql from "../migrations/0013_ballot_choice_abstain.sql?raw";
import abstainCountedSql from "../migrations/0014_abstain_counted.sql?raw";
import liveVoterRollSql from "../migrations/0015_live_voter_roll.sql?raw";
import closingHakPilihSql from "../migrations/0016_closing_hak_pilih.sql?raw";
import directInvitationsSql from "../migrations/0017_direct_invitations.sql?raw";


declare module "*.sql?raw" {
  const content: string;
  export default content;
}

const TABLES = [
  "system_config",
  "admin_voting",
  "invitations",
  "elections",
  "candidates",
  "voters",
  "participation",
  "ballots",
  "reminders",
  "audit_log",
  "units",
  "direct_invitations",
];

beforeEach(async () => {
  await reset();
  const statements = [
    migrationSql,
    unitsMigrationSql,
    electionLockMigrationSql,
    closingSnapshotMigrationSql,
    singleCandidateModeMigrationSql,
    ballotChoiceMigrationSql,
    ballotAbstainMigrationSql,
    abstainCountedSql,
    liveVoterRollSql,
    closingHakPilihSql,
    directInvitationsSql,
  ].join(";")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => env.DB.prepare(statement));
  await env.DB.batch(statements);
});

function insertElection(id: number) {
  return env.DB.prepare("INSERT INTO elections (id) VALUES (?)").bind(id).run();
}

function insertCandidate(id: number, memberId: string) {
  return env.DB.prepare(
    "INSERT INTO candidates (id, member_id, number, name, nickname, komsat_path) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, memberId, id, `Kandidat ${id}`, `kandidat-${id}`, "PPIJ/PPI Okayama")
    .run();
}

describe("migrations/0001_init.sql", () => {
  it("membuat semua tabel", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all<{ name: string }>();
    const names = results.map((row) => row.name);
    for (const table of TABLES) {
      expect(names).toContain(table);
    }
  });
  it("creates constrained unit paths", async () => {
    await env.DB.prepare("INSERT INTO units (path,name,parent_path,type) VALUES ('/ppij','PPIJ','','national')").run();
    await expect(env.DB.prepare("INSERT INTO units (path,name,parent_path,type) VALUES ('/bad','Bad','/ppij','province')").run()).rejects.toThrow();
    await expect(env.DB.prepare("INSERT INTO units (path,name,parent_path,type) VALUES ('/ppij','Duplicate','/','national')").run()).rejects.toThrow();
  });

  it("menolak partisipasi ganda untuk anggota yang sama di satu pemilihan", async () => {
    await insertElection(1);
    await env.DB.prepare(
      "INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(1, "m-1", "Anggota m-1", "2026-12-02T05:00:00Z", 0)
      .run();
    await expect(
      env.DB.prepare(
        "INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(1, "m-1", "Anggota m-1", "2026-12-02T05:00:00Z", 0)
        .run()
    ).rejects.toThrow(
      /UNIQUE constraint failed: participation\.election_id, participation\.member_id/
    );
  });

  it("ballots hanya punya kolom tanpa anggota dan tanpa waktu", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(ballots)").all<{
      name: string;
    }>();
    const columns = results.map((row) => row.name);
    // choice hanya berisi jawaban Setuju/Tidak Setuju/Abstain (mode kandidat tunggal);
    // tidak ada kolom anggota dan tidak ada kolom waktu.
    expect(columns).toEqual([
      "id",
      "election_id",
      "candidate_id",
      "komsat_path",
      "receipt_hash",
      "is_test",
      "choice",
    ]);
  });

  it("ballots tidak punya rowid", async () => {
    await insertElection(1);
    await insertCandidate(1, "m-c-1");
    await env.DB.prepare(
      "INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind("b-1", 1, 1, "PPIJ/PPI Okayama", "hash-b-1", 0)
      .run();
    await expect(
      env.DB.prepare("SELECT rowid FROM ballots LIMIT 1").all()
    ).rejects.toThrow(/no such column: rowid/);
  });

  it("mode kandidat tunggal mati secara bawaan dan hanya menerima 0/1", async () => {
    await insertElection(1);
    expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections WHERE id = 1").first())
      .toEqual({ single_candidate_mode: 0 });
    await env.DB.prepare("UPDATE elections SET single_candidate_mode = 1 WHERE id = 1").run();
    expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections WHERE id = 1").first())
      .toEqual({ single_candidate_mode: 1 });
    await expect(env.DB.prepare("UPDATE elections SET single_candidate_mode = 2 WHERE id = 1").run())
      .rejects.toThrow(/CHECK constraint failed/);
  });

  it("saklar Tidak Membekukan DPT mati secara bawaan dan hanya menerima 0/1", async () => {
    await insertElection(1);
    expect(await env.DB.prepare("SELECT live_voter_roll FROM elections WHERE id = 1").first())
      .toEqual({ live_voter_roll: 0 });
    await env.DB.prepare("UPDATE elections SET live_voter_roll = 1 WHERE id = 1").run();
    expect(await env.DB.prepare("SELECT live_voter_roll FROM elections WHERE id = 1").first())
      .toEqual({ live_voter_roll: 1 });
    await expect(env.DB.prepare("UPDATE elections SET live_voter_roll = 2 WHERE id = 1").run())
      .rejects.toThrow(/CHECK constraint failed/);
  });

  it("kolom Hak pilih akhir menerima NULL lalu angka dan waktu", async () => {
    await insertElection(1);
    expect(await env.DB.prepare("SELECT closing_hak_pilih, closing_hak_pilih_at FROM elections WHERE id = 1").first())
      .toEqual({ closing_hak_pilih: null, closing_hak_pilih_at: null });
    await env.DB
      .prepare("UPDATE elections SET closing_hak_pilih = ?, closing_hak_pilih_at = ? WHERE id = 1")
      .bind(118, "2026-12-02T12:00:00Z")
      .run();
    expect(await env.DB.prepare("SELECT closing_hak_pilih, closing_hak_pilih_at FROM elections WHERE id = 1").first())
      .toEqual({ closing_hak_pilih: 118, closing_hak_pilih_at: "2026-12-02T12:00:00Z" });
    // Angka negatif tidak masuk akal; kolom bebas tapi tulisan kembali NULL boleh.
    await env.DB.prepare("UPDATE elections SET closing_hak_pilih = NULL, closing_hak_pilih_at = NULL WHERE id = 1").run();
    expect(await env.DB.prepare("SELECT closing_hak_pilih FROM elections WHERE id = 1").first())
      .toEqual({ closing_hak_pilih: null });
  });

  it("menerima hanya setuju/tidak_setuju/abstain dan NULL pada ballots.choice", async () => {
    await insertElection(1);
    await insertCandidate(1, "m-c-1");
    const insertBallot = (id: string, choice: string | null) =>
      env.DB.prepare(
        "INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test, choice) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(id, 1, 1, "PPIJ/PPI Okayama", `hash-${id}`, 0, choice)
        .run();
    // NULL = surat suara multi-kandidat biasa; tiga jawaban hanya dipakai di mode kandidat tunggal.
    await insertBallot("b-null", null);
    for (const choice of ["setuju", "tidak_setuju", "abstain"]) await insertBallot(`b-${choice}`, choice);
    for (const choice of ["setuju-banget", "Abstain", ""]) {
      await expect(insertBallot(`b-bad-${choice}`, choice)).rejects.toThrow(/CHECK constraint failed/);
    }
    const { results } = await env.DB.prepare("SELECT choice FROM ballots ORDER BY id").all<{ choice: string | null }>();
    expect(results.map((row) => row.choice)).toEqual(["abstain", null, "setuju", "tidak_setuju"]);
  });

  it("0013 membangun ulang ballots tanpa kehilangan baris, indeks, atau WITHOUT ROWID", async () => {
    // Rebuild dijalankan ulang atas data yang sudah ada: baris dari sebelum 0013 tetap utuh.
    await reset();
    const before = [migrationSql, unitsMigrationSql, electionLockMigrationSql, closingSnapshotMigrationSql, singleCandidateModeMigrationSql, ballotChoiceMigrationSql]
      .join(";").split(";").map((statement) => statement.trim()).filter(Boolean);
    await env.DB.batch(before.map((statement) => env.DB.prepare(statement)));
    await insertElection(1);
    await insertCandidate(1, "m-c-1");
    const insertBallot = (id: string, choice: string | null) =>
      env.DB.prepare(
        "INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test, choice) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(id, 1, 1, "PPIJ/PPI Okayama", `hash-${id}`, 0, choice)
        .run();
    await insertBallot("old-null", null);
    await insertBallot("old-setuju", "setuju");
    await insertBallot("old-tidak", "tidak_setuju");
    // Sebelum 0013 abstain ditolak.
    await expect(insertBallot("old-abstain", "abstain")).rejects.toThrow(/CHECK constraint failed/);
    await env.DB.batch(
      ballotAbstainMigrationSql.split(";").map((statement) => statement.trim()).filter(Boolean).map((statement) => env.DB.prepare(statement)),
    );
    const { results } = await env.DB.prepare("SELECT id, choice, receipt_hash FROM ballots ORDER BY id").all<{ id: string; choice: string | null; receipt_hash: string }>();
    expect(results).toEqual([
      { id: "old-null", choice: null, receipt_hash: "hash-old-null" },
      { id: "old-setuju", choice: "setuju", receipt_hash: "hash-old-setuju" },
      { id: "old-tidak", choice: "tidak_setuju", receipt_hash: "hash-old-tidak" },
    ]);
    await insertBallot("new-abstain", "abstain");
    // receipt_hash tetap UNIQUE, rowid tetap tidak ada, kedua indeks dibuat ulang, tidak ada tabel sisa.
    await expect(insertBallot("dup", "setuju").then(() => env.DB.prepare("INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test) VALUES ('dup2', 1, 1, 'x', 'hash-dup', 0)").run()))
      .rejects.toThrow(/UNIQUE constraint failed/);
    await expect(env.DB.prepare("SELECT rowid FROM ballots LIMIT 1").all()).rejects.toThrow(/no such column: rowid/);
    const indexes = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ballots' AND name LIKE 'idx_%' ORDER BY name").all<{ name: string }>();
    expect(indexes.results.map((row) => row.name)).toEqual(["idx_ballots_election_candidate", "idx_ballots_election_komsat"]);
    expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'ballots_new'").first()).toBeNull();
  });

  it("menolak receipt_hash yang sama", async () => {
    await insertElection(1);
    await insertCandidate(1, "m-c-1");
    await env.DB.prepare(
      "INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind("b-1", 1, 1, "PPIJ/PPI Okayama", "hash-sama", 0)
      .run();
    await expect(
      env.DB.prepare(
        "INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind("b-2", 1, 1, "PPIJ/PPI Okayama", "hash-sama", 0)
        .run()
    ).rejects.toThrow(/UNIQUE constraint failed: ballots\.receipt_hash/);
  });

  it("mengembalikan seluruh batch ketika anggota sudah memilih", async () => {
    await insertElection(2);
    await insertCandidate(11, "m-c-11");

    const participationStmt = env.DB
      .prepare(
        "INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(2, "m-dup", "Anggota m-dup", "2026-12-02T05:00:00Z", 0);
    await env.DB.batch([
      participationStmt,
      env.DB.prepare(
        "INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind("b-1", 2, 11, "PPIJ/PPI Okayama", "hash-a", 0),
    ]);

    const duplicateBatch = env.DB.batch([
      participationStmt,
      env.DB.prepare(
        "INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind("b-2", 2, 11, "PPIJ/PPI Okayama", "hash-b", 0),
    ]);
    await expect(duplicateBatch).rejects.toThrow(
      /UNIQUE constraint failed: participation\.election_id, participation\.member_id/
    );

    const ballots = await env.DB.prepare(
      "SELECT id FROM ballots WHERE election_id = 2 ORDER BY id"
    ).all<{ id: string }>();
    expect(ballots.results.map((row) => row.id)).toEqual(["b-1"]);

    const participations = await env.DB.prepare(
      "SELECT member_id FROM participation WHERE election_id = 2"
    ).all<{ member_id: string }>();
    expect(participations.results).toEqual([{ member_id: "m-dup" }]);
  });

  it("0017 membuat direct_invitations tanpa menyentuh tabel invitations", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(direct_invitations)").all<{ name: string; notnull: number }>();
    expect(results.map((row) => row.name)).toEqual([
      "id",
      "reference",
      "token_hash",
      "token_enc",
      "created_at",
      "created_by",
      "created_by_name",
      "claimed_at",
      "claim_id",
      "guest_name",
      "guest_email",
      "komsat_path",
      "used_at",
      "cancelled_at",
      "cancelled_by",
      "cancelled_by_name",
    ]);
    const required = new Set(["reference", "token_hash", "token_enc", "created_at", "created_by", "created_by_name"]);
    for (const column of results) {
      if (required.has(column.name)) expect(column.notnull).toBe(1);
      else expect(column.notnull).toBe(0);
    }
    await env.DB.prepare(
      "INSERT INTO direct_invitations (reference,token_hash,token_enc,created_at,created_by,created_by_name) VALUES ('AAA111','hash-1','v1:x:y','2026-11-19T00:00:00Z','admin-1','Admin 1')",
    ).run();
    await expect(
      env.DB.prepare(
        "INSERT INTO direct_invitations (reference,token_hash,token_enc,created_at,created_by,created_by_name) VALUES ('AAA111','hash-2','v1:x:y','2026-11-19T00:00:00Z','admin-1','Admin 1')",
      ).run(),
    ).rejects.toThrow(/UNIQUE constraint failed: direct_invitations\.reference/);
    await expect(
      env.DB.prepare(
        "INSERT INTO direct_invitations (reference,token_hash,token_enc,created_at,created_by,created_by_name) VALUES ('BBB222','hash-1','v1:x:y','2026-11-19T00:00:00Z','admin-1','Admin 1')",
      ).run(),
    ).rejects.toThrow(/UNIQUE constraint failed: direct_invitations\.token_hash/);
    const index = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'direct_invitations' AND name LIKE 'idx_%' ORDER BY name",
    ).all<{ name: string }>();
    expect(index.results.map((row) => row.name)).toEqual(["idx_direct_invitations_status"]);
    // Tabel undangan Admin Voting tetap seperti semula.
    const legacy = await env.DB.prepare("PRAGMA table_info(invitations)").all<{ name: string }>();
    expect(legacy.results.map((row) => row.name)).toEqual(["token_hash", "member_id", "created_at", "expires_at", "accepted_at", "cancelled_at"]);
  });
});
