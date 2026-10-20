import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import migrationSql from "../migrations/0001_init.sql?raw";
import unitsMigrationSql from "../migrations/0002_units.sql?raw";
import electionLockMigrationSql from "../migrations/0003_election_lock.sql?raw";
import closingSnapshotMigrationSql from "../migrations/0005_closing_snapshot.sql?raw";


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
];

beforeEach(async () => {
  await reset();
  const statements = [migrationSql, unitsMigrationSql, electionLockMigrationSql, closingSnapshotMigrationSql].join(";")
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
    expect(columns).toEqual([
      "id",
      "election_id",
      "candidate_id",
      "komsat_path",
      "receipt_hash",
      "is_test",
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
});
