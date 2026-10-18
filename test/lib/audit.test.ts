import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  AUDIT_GENESIS_HASH,
  buildAuditInsert,
  verifyChain,
  type AuditEntry,
  type AuditRow,
} from "../../src/server/lib/audit";

// Task 1.3 runs before the migration task lands; this DDL is copied from
// design.md decision 9 (column list; the design adds no constraints).
const AUDIT_LOG_DDL = `CREATE TABLE audit_log (
  seq INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_member_id TEXT,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  komsat_path TEXT,
  detail_json TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
)`;

const db = env.DB;

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    at: "2026-12-02T05:05:00Z",
    actor_type: "admin",
    actor_member_id: "member-1",
    actor_name: "Rina Putri",
    action: "pengaturan.email",
    target: "email",
    komsat_path: null,
    detail_json: '{"penyedia":{"dari":"resend","ke":"zeptomail"}}',
    ...overrides,
  };
}

async function insertAudit(entryOverrides: Partial<AuditEntry> = {}): Promise<void> {
  const stmt = await buildAuditInsert(db, entry(entryOverrides));
  await db.batch([stmt]);
}

async function rows(): Promise<AuditRow[]> {
  const result = await db.prepare("SELECT * FROM audit_log ORDER BY seq").all<AuditRow>();
  return result.results;
}

beforeEach(async () => {
  // The runtime D1Database here exposes prepare/batch/exec (no run on the database itself).
  await db.prepare("DROP TABLE IF EXISTS audit_log").run();
  await db.prepare(AUDIT_LOG_DDL).run();
});

describe("buildAuditInsert", () => {
  it("menaut rantai: prev_hash baris pertama genesis, berikutnya hash baris sebelumnya", async () => {
    await insertAudit({ action: "a1" });
    await insertAudit({ action: "a2" });
    await insertAudit({ action: "a3" });
    const log = await rows();
    expect(log.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(log[0]!.prev_hash).toBe(AUDIT_GENESIS_HASH);
    expect(log[1]!.prev_hash).toBe(log[0]!.hash);
    expect(log[2]!.prev_hash).toBe(log[1]!.hash);
    expect(await verifyChain(log)).toBeNull();
  });

  it("hasilnya prepared statement yang bisa dijalankan dalam satu batch bersama aksinya", async () => {
    const stmt = await buildAuditInsert(db, entry({ action: "dalam-batch" }));
    await db.batch([stmt]);
    const log = await rows();
    expect(log).toHaveLength(1);
    expect(log[0]!.action).toBe("dalam-batch");
    expect(await verifyChain(log)).toBeNull();
  });
});

describe("verifyChain", () => {
  it("log kosong utuh", async () => {
    expect(await verifyChain([])).toBeNull();
  });

  it("melaporkan seq baris yang diedit langsung di D1", async () => {
    await insertAudit({ action: "a1" });
    await insertAudit({ action: "a2" });
    await insertAudit({ action: "a3" });
    await db.prepare("UPDATE audit_log SET action = 'diubah' WHERE seq = 2").run();
    expect(await verifyChain(await rows())).toBe(2);
  });

  it("melaporkan entri pertama setelah baris yang dihapus", async () => {
    await insertAudit({ action: "a1" });
    await insertAudit({ action: "a2" });
    await insertAudit({ action: "a3" });
    await db.prepare("DELETE FROM audit_log WHERE seq = 2").run();
    expect(await verifyChain(await rows())).toBe(3);
  });

  it("melaporkan baris kedua saat baris pertama dihapus", async () => {
    await insertAudit({ action: "a1" });
    await insertAudit({ action: "a2" });
    await db.prepare("DELETE FROM audit_log WHERE seq = 1").run();
    expect(await verifyChain(await rows())).toBe(2);
  });
});
