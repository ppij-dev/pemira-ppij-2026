import type { D1Database } from "@cloudflare/workers-types";

/**
 * Satu-satunya tempat menghitung Hak pilih (mode "Tidak Membekukan DPT",
 * fallback Draf untuk roll beku, dan snap shot penutupan): anggota roll yang
 * portalnya menyatakan boleh memilih (can_vote = 1), dikurangi Admin Voting saat
 * pengaturan melarang mereka ikut memilih, DITAMBAH setiap tautan Undangan
 * Langsung yang belum dibatalkan. Rumus roll-nya sama dengan yang dipakai Kunci
 * & Jadwalkan saat membekukan roll, sehingga semua konsumen selalu sepakat.
 *
 * Titik sambung Undangan Langsung (migrasi 0017): istilah
 * "+ tautan undangan yang belum dibatalkan" tinggal di sini saja, jadi hitungan
 * live, fallback Draf, snapshot penutupan (ensureClosingHakPilih) dan Tutup
 * Sekarang semuanya ikut menghitungnya. `frozen_hak_pilih` tetap hanya suku roll;
 * jalur roll beku menambahkan istilahnya lewat `withDirectInvites`.
 */

/** Baris tautan yang belum dibatalkan; tautan yang sudah dipakai tetap terhitung. */
export const DIRECT_INVITE_HAK_PILIH_SQL =
  "SELECT COUNT(*) AS n FROM direct_invitations WHERE cancelled_at IS NULL";

/** Jumlah tautan Undangan Langsung yang menambah Hak pilih. */
export async function directInviteTerm(db: D1Database): Promise<number> {
  const row = await db.prepare(DIRECT_INVITE_HAK_PILIH_SQL).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Suku dasar tersimpan (roll beku atau snapshot) + tautan aktif. */
export function withDirectInvites(base: number, invite: number): number {
  return base + invite;
}

export async function liveHakPilih(db: D1Database): Promise<number> {
  const election = await db
    .prepare("SELECT allow_admin_voting FROM elections ORDER BY id LIMIT 1")
    .first<{ allow_admin_voting: number }>();
  const eligible = (await db.prepare("SELECT COUNT(*) AS n FROM voters WHERE can_vote = 1").first<{ n: number }>())?.n ?? 0;
  let base = eligible;
  if (election?.allow_admin_voting === 0) {
    const admins = (
      await db
        .prepare("SELECT COUNT(*) AS n FROM voters v JOIN admin_voting a ON a.member_id = v.member_id WHERE v.can_vote = 1")
        .first<{ n: number }>()
    )?.n ?? 0;
    base = eligible - admins;
  }
  return withDirectInvites(base, await directInviteTerm(db));
}
