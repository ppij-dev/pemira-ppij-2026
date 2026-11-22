/**
 * Surat suara Undangan Langsung: kerahasiaan, aturan yang sama dengan Pemilih,
 * satu kali pakai per tautan (termasuk dua permintaan bersamaan), kode bukti,
 * dan audit tanpa pilihan kandidat.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import lockSql from "../migrations/0003_election_lock.sql?raw";
import limitsSql from "../migrations/0004_vote_limits.sql?raw";
import snapshotSql from "../migrations/0005_closing_snapshot.sql?raw";
import previewSql from "../migrations/0006_preview_mode.sql?raw";
import memberNumberSql from "../migrations/0008_member_number.sql?raw";
import voterCategorySql from "../migrations/0009_voter_category.sql?raw";
import voterCanVoteSql from "../migrations/0010_voter_can_vote.sql?raw";
import singleModeSql from "../migrations/0011_single_candidate_mode.sql?raw";
import ballotChoiceSql from "../migrations/0012_ballot_choice.sql?raw";
import ballotAbstainSql from "../migrations/0013_ballot_choice_abstain.sql?raw";
import abstainCountedSql from "../migrations/0014_abstain_counted.sql?raw";
import liveRollSql from "../migrations/0015_live_voter_roll.sql?raw";
import closingHakPilihSql from "../migrations/0016_closing_hak_pilih.sql?raw";
import directInvitationsSql from "../migrations/0017_direct_invitations.sql?raw";
import { app } from "../src/server/app";
import { buildAuditInsert } from "../src/server/lib/audit";
import { hashReceipt } from "../src/server/voting/receipt";
import { generateDirectInvitations } from "../src/server/direct/create";
import { claimDirectInvitation, openInviteSession } from "../src/server/direct/claim";
import { InviteVoteError, castInviteVote } from "../src/server/direct/vote";
import { resolveDirectLink } from "../src/server/direct/open";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

declare module "*.sql?raw" { const sql: string; export default sql; }

const MASTER_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const SCOPE = "/ppij/okayama";
const BASE_URL = "https://election.test";
const OPENS_AT = new Date(Date.now() - 60_000).toISOString();
const CLOSES_AT = new Date(Date.now() + 2 * 3_600_000).toISOString();
const bindings = { DB: env.DB, APP_MASTER_KEY: MASTER_KEY };
const actor = { member_id: "admin-1", name: "Admin 1" };

const MIGRATIONS = [
  initSql, unitsSql, lockSql, limitsSql, snapshotSql, previewSql, memberNumberSql,
  voterCategorySql, voterCanVoteSql, singleModeSql, ballotChoiceSql, ballotAbstainSql,
  abstainCountedSql, liveRollSql, closingHakPilihSql, directInvitationsSql,
];

async function applyMigrations() {
  const statements = MIGRATIONS.join(";").split(";").map((statement) => statement.trim()).filter(Boolean);
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

async function seedElection(single = 0) {
  await env.DB.prepare(
    "INSERT INTO elections (title,status_lock,opens_at,closes_at,frozen_at,frozen_hak_pilih,single_candidate_mode,preview_mode) VALUES ('Pemilihan','locked',?,?,?,100,?,0)",
  ).bind(OPENS_AT, CLOSES_AT, new Date().toISOString(), single).run();
  await env.DB.prepare(
    "INSERT INTO candidates (member_id,number,name,nickname,komsat_path) VALUES ('cand-1',1,'Budi Santoso','Budi',?),('cand-2',2,'Siti Aminah','Siti',?)",
  ).bind(`${SCOPE}/komsat-okayama`, `${SCOPE}/komsat-okayama`).run();
}

/** Tautan siap vote: dibuat Admin Voting lalu diklaim tamu. */
async function readyLink(name = "Budi Tamu", komsat = `${SCOPE}/komsat-okayama`) {
  const created = await generateDirectInvitations(env.DB, new Date(), 1, actor, { masterKey: MASTER_KEY, baseUrl: BASE_URL });
  const code = new URL(created.links[0]!.link).pathname.split("/").at(-1)!;
  const claim = await claimDirectInvitation(
    env.DB,
    new Date(),
    { kode: code, nama: name, email: "tamu@example.test", komsat_path: komsat },
    null,
    { masterKey: MASTER_KEY, scope: SCOPE },
  );
  return { session: claim.session, cookie: claim.cookie, reference: created.links[0]!.reference, id: created.links[0]!.id };
}

beforeEach(async () => {
  await reset();
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO system_config (key,value) VALUES ('initialized','1'),('site_scope',?),('site_base_url',?)").bind(SCOPE, BASE_URL),
    env.DB.prepare("INSERT INTO admin_voting (member_id,name,is_technical,created_at) VALUES ('admin-1','Admin 1',1,?)").bind(new Date().toISOString()),
    env.DB.prepare("INSERT INTO voters (member_id,name,member_number,category,can_vote,komsat_path,status,synced_at) VALUES ('admin-1','Admin 1','OKA-1','BIASA',1,?,'ACTIVE',?)").bind(SCOPE, new Date().toISOString()),
    env.DB.prepare("INSERT INTO units (path,name,parent_path,type) VALUES (?,?,?,'korda'),(?,?,?,'komsat')")
      .bind(SCOPE, "PPI Okayama", "/ppij", `${SCOPE}/komsat-okayama`, "PPI Okayama Kota", SCOPE),
  ]);
});

describe("surat suara undangan", () => {
  it("menulis partisipasi, surat suara dan audit dalam satu batch, tanpa baris voters", async () => {
    await seedElection();
    const { session, cookie } = await readyLink();
    const reopened = await openInviteSession(cookie, MASTER_KEY);
    expect(reopened!.guest_name).toBe("Budi Tamu");
    expect(reopened!.invitation_id).toBe(session.invitation_id);
    const result = await castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "budi" });
    expect(result.receipt_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);

    const participation = await env.DB
      .prepare("SELECT election_id, member_id, member_name, is_test FROM participation")
      .first<{ election_id: number; member_id: string; member_name: string; is_test: number }>();
    const invitation = await env.DB.prepare("SELECT reference, used_at FROM direct_invitations WHERE id=?").bind(session.invitation_id).first<{ reference: string; used_at: string | null }>();
    expect(participation!.member_id).toBe(`undangan:${invitation!.reference}`);
    expect(participation!.member_name).toBe("Budi Tamu");
    expect(participation!.is_test).toBe(0);

    const ballot = await env.DB
      .prepare("SELECT candidate_id, komsat_path, receipt_hash, is_test, choice FROM ballots")
      .first<{ candidate_id: number; komsat_path: string; receipt_hash: string; is_test: number; choice: string | null }>();
    expect(ballot!.candidate_id).toBe(1);
    expect(ballot!.komsat_path).toBe(`${SCOPE}/komsat-okayama`);
    expect(ballot!.is_test).toBe(0);
    expect(ballot!.choice).toBeNull();
    expect(ballot!.receipt_hash).toBe(await hashReceipt(result.receipt_code));

    expect(invitation!.used_at).not.toBeNull();

    const audit = await env.DB
      .prepare("SELECT actor_type, actor_member_id, actor_name, action, target, komsat_path, detail_json FROM audit_log ORDER BY seq DESC LIMIT 1")
      .first<{ actor_type: string; actor_member_id: string; actor_name: string; action: string; target: string; komsat_path: string; detail_json: string | null }>();
    expect(audit!.actor_type).toBe("voter");
    expect(audit!.actor_member_id).toBe(participation!.member_id);
    expect(audit!.actor_name).toBe("Budi Tamu");
    expect(audit!.action).toBe("Pemungutan suara undangan");
    expect(audit!.target).toBe(participation!.member_id);
    expect(audit!.komsat_path).toBe(`${SCOPE}/komsat-okayama`);
    expect(audit!.detail_json).toBeNull();

    const voters = await env.DB.prepare("SELECT COUNT(*) AS n FROM voters").first<{ n: number }>();
    expect(voters!.n).toBe(1);
  });

  it("menolak konfirmasi salah, tautan terpakai, dan pilihan ganda di mode biasa tanpa menulis apa pun", async () => {
    await seedElection();
    const { session, id } = await readyLink();
    await expect(castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "salah" })).rejects.toMatchObject({ reason: "confirmation_mismatch" });
    await expect(castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi", choice: "setuju" })).rejects.toMatchObject({ reason: "invalid_choice" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM participation").first<{ n: number }>())!.n).toBe(0);
    await castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" });
    await expect(castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" })).rejects.toMatchObject({ reason: "invite_used" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM participation").first<{ n: number }>())!.n).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots").first<{ n: number }>())!.n).toBe(1);
    const invitation = await env.DB.prepare("SELECT used_at FROM direct_invitations WHERE id=?").bind(id).first<{ used_at: string | null }>();
    expect(invitation!.used_at).not.toBeNull();
  });

  it("menyimpan jawaban mode kandidat tunggal dan menolak kandidat lain", async () => {
    await seedElection(1);
    const { session } = await readyLink();
    await expect(castInviteVote(env.DB, session, { candidate_id: 2, confirmation_text: "Budi", choice: "setuju" })).rejects.toMatchObject({ reason: "candidate_mismatch" });
    await expect(castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" })).rejects.toMatchObject({ reason: "invalid_choice" });
    // Abstain tidak dapat dipilih lagi (keputusan owner 2026-11-22).
    await expect(castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi", choice: "abstain" })).rejects.toMatchObject({ status: 400, reason: "invalid_choice" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots").first<{ n: number }>())!.n).toBe(0);
    await castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi", choice: "tidak_setuju" });
    const ballot = await env.DB.prepare("SELECT candidate_id, choice FROM ballots").first<{ candidate_id: number; choice: string | null }>();
    expect(ballot!.candidate_id).toBe(1);
    expect(ballot!.choice).toBe("tidak_setuju");
  });

  it("membuka tautan dan mengisi klaim tidak menandai tautan terpakai; hanya suara yang terkirim", async () => {
    await seedElection(1);
    const created = await generateDirectInvitations(env.DB, new Date(), 1, actor, { masterKey: MASTER_KEY, baseUrl: BASE_URL });
    const code = new URL(created.links[0]!.link).pathname.split("/").at(-1)!;
    const claim = await claimDirectInvitation(
      env.DB,
      new Date(),
      { kode: code, nama: "Tamu Satu", email: "tamu@example.test", komsat_path: `${SCOPE}/komsat-okayama` },
      null,
      { masterKey: MASTER_KEY, scope: SCOPE },
    );
    // Membuka tautan dan mengisi formulir tidak pernah menandai tautan terpakai.
    const afterClaim = await env.DB.prepare("SELECT used_at, claimed_at FROM direct_invitations WHERE id=?").bind(created.links[0]!.id).first<{ used_at: string | null; claimed_at: string | null }>();
    expect(afterClaim!.used_at).toBeNull();
    expect(afterClaim!.claimed_at).not.toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM participation").first<{ n: number }>())!.n).toBe(0);
    // Hanya suara yang berhasil terkirim yang menandai tautan terpakai.
    await castInviteVote(env.DB, claim.session, { candidate_id: 1, confirmation_text: "Budi", choice: "setuju" });
    const afterVote = await env.DB.prepare("SELECT used_at FROM direct_invitations WHERE id=?").bind(created.links[0]!.id).first<{ used_at: string | null }>();
    expect(afterVote!.used_at).not.toBeNull();
  });

  it("reservasi 30 menit tidak mengunci pemegangnya sendiri dan tidak pernah menyebut sudah dipakai", async () => {
    await seedElection(1);
    const created = await generateDirectInvitations(env.DB, new Date(), 1, actor, { masterKey: MASTER_KEY, baseUrl: BASE_URL });
    const code = new URL(created.links[0]!.link).pathname.split("/").at(-1)!;
    const claimInput = { kode: code, nama: "Tamu Dua", email: "tamu2@example.test", komsat_path: `${SCOPE}/komsat-okayama` };
    const claimOpts = { masterKey: MASTER_KEY, scope: SCOPE };
    const first = await claimDirectInvitation(env.DB, new Date(), claimInput, null, claimOpts);
    // Pemegang reservasi (claim_id sama, peramban yang sama) boleh melanjutkan.
    const holder = await claimDirectInvitation(env.DB, new Date(), { ...claimInput, nama: "Tamu Dua Revised" }, first.session.claim_id, claimOpts);
    expect(holder.session.claim_id).toBe(first.session.claim_id);
    // Konteks peramban lain tidak mengambil alih reservasi — pesannya sedang
    // diisi orang lain, bukan "sudah dipakai".
    await expect(claimDirectInvitation(env.DB, new Date(), { ...claimInput, nama: "Tamu Lain" }, null, claimOpts)).rejects.toMatchObject({ reason: "invite_reserved" });
  });

  it("klaim menolak tautan yang sudah menulis suara walau kolom tautan direset", async () => {
    await seedElection(1);
    const created = await generateDirectInvitations(env.DB, new Date(), 1, actor, { masterKey: MASTER_KEY, baseUrl: BASE_URL });
    const code = new URL(created.links[0]!.link).pathname.split("/").at(-1)!;
    const reference = created.links[0]!.reference;
    // Buku besar mencatat suara undangan ini, tetapi baris tautannya direset
    // by hand (used_at NULL): klaim harus menolak sejak awal, jujur.
    await env.DB
      .prepare("INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (1, ?, 'Tamu Lama', ?, 0)")
      .bind(`undangan:${reference}`, new Date().toISOString())
      .run();
    await expect(claimDirectInvitation(
      env.DB,
      new Date(),
      { kode: code, nama: "Tamu Baru", email: "tamu3@example.test", komsat_path: `${SCOPE}/komsat-okayama` },
      null,
      { masterKey: MASTER_KEY, scope: SCOPE },
    )).rejects.toMatchObject({ reason: "invite_used" });
  });

  it("kegagalan batch yang bukan suara ganda tidak melaporkan sudah dipakai", async () => {
    await seedElection(1);
    const { session, id } = await readyLink();
    // Batch yang selalu gagal dengan kesalahan batasan, tanpa pernah menulis:
    // tautan tetap bersih, jadi pesan tidak boleh menyebut "sudah dipakai".
    const sabotaged = {
      prepare: (...args: Parameters<typeof env.DB.prepare>) => env.DB.prepare(...args),
      batch: async () => {
        throw new Error("UNIQUE constraint failed: participation.election_id, participation.member_id");
      },
    } as unknown as typeof env.DB;
    await expect(castInviteVote(sabotaged, session, { candidate_id: 1, confirmation_text: "Budi", choice: "setuju" })).rejects.toMatchObject({ reason: "vote_write_failed" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM participation").first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots").first<{ n: number }>())!.n).toBe(0);
    const invitation = await env.DB.prepare("SELECT used_at FROM direct_invitations WHERE id=?").bind(id).first<{ used_at: string | null }>();
    expect(invitation!.used_at).toBeNull();
    // Ketika suara undangan ini memang sudah ada di buku besar, pesan tetap
    // "sudah dipakai" — kini berdasar fakta, bukan tebakan.
    const reference = (await env.DB.prepare("SELECT reference FROM direct_invitations WHERE id=?").bind(id).first<{ reference: string }>())!.reference;
    await env.DB
      .prepare("INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (1, ?, 'Tamu Lama', ?, 0)")
      .bind(`undangan:${reference}`, new Date().toISOString())
      .run();
    await expect(castInviteVote(sabotaged, session, { candidate_id: 1, confirmation_text: "Budi", choice: "setuju" })).rejects.toMatchObject({ reason: "invite_used" });
  });

  it("menghasilkan tepat satu suara untuk dua permintaan bersamaan", async () => {
    await seedElection();
    const { session } = await readyLink();
    const results = await Promise.allSettled([
      castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" }),
      castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" }),
    ]);
    const fulfilled = results.filter((row) => row.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM participation").first<{ n: number }>())!.n).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots").first<{ n: number }>())!.n).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='Pemungutan suara undangan'").first<{ n: number }>())!.n).toBe(1);
  });

  it("mencoba ulang saat tip audit berubah tanpa kehilangan suara", async () => {
    await seedElection();
    const { session } = await readyLink();
    let injected = false;
    const result = await castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" }, {
      beforeBatch: async () => {
        if (injected) return;
        injected = true;
        await env.DB.batch([
          await buildAuditInsert(env.DB, {
            at: new Date().toISOString(), actor_type: "system", actor_member_id: null, actor_name: "Sistem",
            action: "Uji tip", target: null, komsat_path: null, detail_json: null,
          }),
        ]);
      },
    });
    expect(result.receipt_code).toBeTruthy();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM participation").first<{ n: number }>())!.n).toBe(1);
  });

  it("menolak vote setelah pemungutan suara ditutup dan setelah dibatalkan", async () => {
    await seedElection();
    const first = await readyLink();
    await env.DB.prepare("UPDATE elections SET closes_at=? WHERE id=1").bind(new Date(Date.now() - 1_000).toISOString()).run();
    await expect(castInviteVote(env.DB, first.session, { candidate_id: 1, confirmation_text: "Budi" })).rejects.toMatchObject({ reason: "not_open" });
    await env.DB.prepare("UPDATE elections SET closes_at=? WHERE id=1").bind(CLOSES_AT).run();
    const second = await readyLink("Siti Tamu");
    await env.DB.prepare("UPDATE direct_invitations SET cancelled_at=? WHERE id=?").bind(new Date().toISOString(), second.id).run();
    await expect(castInviteVote(env.DB, second.session, { candidate_id: 1, confirmation_text: "Budi" })).rejects.toMatchObject({ reason: "invite_cancelled" });
  });

  it("tetap dapat diklaim dan dipakai saat pemilihan dikunci dengan Tidak Membekukan DPT", async () => {
    await seedElection(1);
    // Produksi: saklar "Tidak Membekukan DPT" menyala saat Kunci, jadi
    // frozen_at dan frozen_hak_pilih sengaja NULL (lihat lockElection).
    await env.DB.prepare("UPDATE elections SET frozen_at=NULL, frozen_hak_pilih=NULL, live_voter_roll=1 WHERE id=1").run();
    const created = await generateDirectInvitations(env.DB, new Date(), 1, actor, { masterKey: MASTER_KEY, baseUrl: BASE_URL });
    const code = new URL(created.links[0]!.link).pathname.split("/").at(-1)!;
    const claim = await claimDirectInvitation(
      env.DB,
      new Date(),
      { kode: code, nama: "Tamu DPT Hidup", email: "tamu@example.test", komsat_path: `${SCOPE}/komsat-okayama` },
      null,
      { masterKey: MASTER_KEY, scope: SCOPE },
    );
    const result = await castInviteVote(env.DB, claim.session, { candidate_id: 1, confirmation_text: "Budi", choice: "setuju" });
    expect(result.receipt_code).toBeTruthy();
    const invitation = await env.DB.prepare("SELECT used_at FROM direct_invitations WHERE id=?").bind(created.links[0]!.id).first<{ used_at: string | null }>();
    expect(invitation!.used_at).not.toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM participation").first<{ n: number }>())!.n).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots").first<{ n: number }>())!.n).toBe(1);
  });

  it("tautan adalah kredensialnya sendiri: tetap berlaku bila DPT tidak dibekukan sama sekali", async () => {
    await seedElection(1);
    // Keadaan setelah baris pemilihan disunting tangan (mis. saklar DPT hidup
    // dimatikan manual setelah Kunci): terkunci, dalam jadwal, tanpa pembekuan.
    await env.DB.prepare("UPDATE elections SET frozen_at=NULL, frozen_hak_pilih=NULL, live_voter_roll=0 WHERE id=1").run();
    const created = await generateDirectInvitations(env.DB, new Date(), 1, actor, { masterKey: MASTER_KEY, baseUrl: BASE_URL });
    const code = new URL(created.links[0]!.link).pathname.split("/").at(-1)!;
    const claim = await claimDirectInvitation(
      env.DB,
      new Date(),
      { kode: code, nama: "Tamu Tanpa Beku", email: "tamu@example.test", komsat_path: `${SCOPE}/komsat-okayama` },
      null,
      { masterKey: MASTER_KEY, scope: SCOPE },
    );
    // Pemegang reservasi melihat halaman undangan biasa, bukan "sudah dipakai".
    expect((await resolveDirectLink(env.DB, new Date(), code)).outcome).toBe("ok");
    await castInviteVote(env.DB, claim.session, { candidate_id: 1, confirmation_text: "Budi", choice: "setuju" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots").first<{ n: number }>())!.n).toBe(1);
  });

  it("klaim yang gagal karena penjaga lain tidak menyebut sudah dipakai", async () => {
    await seedElection(1);
    const created = await generateDirectInvitations(env.DB, new Date(), 1, actor, { masterKey: MASTER_KEY, baseUrl: BASE_URL });
    const code = new URL(created.links[0]!.link).pathname.split("/").at(-1)!;
    // Penjaga di dalam UPDATE tidak mengubah baris (mis. balapan dengan Tutup
    // Sekarang): tautan tetap bersih, jadi pesannya tidak boleh "sudah dipakai"
    // dan tidak boleh menuduh tautan sedang diisi orang lain.
    const guardedDb = {
      prepare: (query: string, ...rest: unknown[]) => {
        const statement = (env.DB.prepare as (...args: unknown[]) => D1PreparedStatement)(query, ...rest);
        if (!query.includes("UPDATE direct_invitations")) return statement;
        return {
          ...statement,
          bind: (...values: unknown[]) => ({
            run: async () => ({ success: true, meta: { changes: 0 }, results: [] }),
            first: async () => null,
            all: async () => ({ results: [] }),
            bind: () => { throw new Error("bind sekali saja"); },
            values: async () => [],
            raw: async () => [],
            _values: values,
          }),
        };
      },
      batch: env.DB.batch.bind(env.DB),
      exec: env.DB.exec.bind(env.DB),
      dump: env.DB.dump.bind(env.DB),
      withSession: env.DB.withSession.bind(env.DB),
    } as unknown as D1Database;
    const failure = await claimDirectInvitation(
      guardedDb,
      new Date(),
      { kode: code, nama: "Tamu Telat", email: "tamu@example.test", komsat_path: `${SCOPE}/komsat-okayama` },
      null,
      { masterKey: MASTER_KEY, scope: SCOPE },
    ).catch((error: unknown) => error as { reason?: string; message?: string });
    expect(failure.reason).toBe("invite_not_ready");
    expect(failure.message).not.toContain("sudah dipakai");
    const row = await env.DB.prepare("SELECT claimed_at, used_at FROM direct_invitations WHERE id=?").bind(created.links[0]!.id).first<{ claimed_at: string | null; used_at: string | null }>();
    expect(row!.used_at).toBeNull();
  });

  it("membatasi percobaan vote per undangan", async () => {
    await seedElection();
    const { session } = await readyLink();
    for (let index = 0; index < 5; index += 1) {
      await expect(castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "salah" })).rejects.toBeInstanceOf(InviteVoteError);
    }
    await expect(castInviteVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" })).rejects.toMatchObject({ reason: "rate_limited" });
  });

  it("menyelesaikan klaim dan vote lewat rute publik", async () => {
    await seedElection();
    const created = await generateDirectInvitations(env.DB, new Date(), 1, actor, { masterKey: MASTER_KEY, baseUrl: BASE_URL });
    const code = new URL(created.links[0]!.link).pathname.split("/").at(-1)!;
    const claimed = await app.request("/api/undangan/klaim", {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ kode: code, nama: "Budi Tamu", email: "tamu@example.test", komsat_path: `${SCOPE}/komsat-okayama` }),
    }, bindings);
    expect(claimed.status).toBe(200);
    const setCookie = claimed.headers.get("set-cookie")!;
    const cookie = setCookie.split(";")[0]!;
    const voted = await app.request("/api/undangan/suara", {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL, cookie },
      body: JSON.stringify({ candidate_id: 1, confirmation_text: "Budi" }),
    }, bindings);
    expect(voted.status).toBe(201);
    const body = (await voted.json()) as { receipt_code: string };
    expect(body.receipt_code).toBeTruthy();
    const again = await app.request("/api/undangan/suara", {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL, cookie },
      body: JSON.stringify({ candidate_id: 1, confirmation_text: "Budi" }),
    }, bindings);
    expect([401, 409]).toContain(again.status);
  });
});

describe("kerahasiaan surat suara undangan", () => {
  it("tidak ada kolom yang menghubungkan surat suara dengan baris undangan", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(ballots)").all<{ name: string }>();
    const names = columns.results.map((column) => column.name);
    expect(names).not.toContain("member_id");
    expect(names).not.toContain("invitation_id");
    expect(names).not.toContain("voted_at");
    const participation = await env.DB.prepare("PRAGMA table_info(participation)").all<{ name: string }>();
    expect(participation.results.map((column) => column.name)).not.toContain("komsat_path");
  });
});
