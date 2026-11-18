import type { D1Database } from "@cloudflare/workers-types";

/**
 * Satu-satunya tempat menghitung Hak pilih live (mode "Tidak Membekukan DPT",
 * dan fallback Draf untuk roll beku): anggota roll yang portalnya menyatakan
 * boleh memilih (can_vote = 1), dikurangi Admin Voting saat pengaturan
 * melarang mereka ikut memilih. Rumus yang sama dipakai Kunci & Jadwalkan saat
 * membekukan roll, sehingga semua konsumen selalu sepakat.
 *
 * Titik sambung direct-invite (perubahan lain, migrasi 0017+): istilah
 * "+ tautan undangan yang belum dibatalkan" ditambahkan di sini saja, untuk
 * hitungan live maupun snapshot penutupan.
 */
export async function liveHakPilih(db: D1Database): Promise<number> {
  const election = await db
    .prepare("SELECT allow_admin_voting FROM elections ORDER BY id LIMIT 1")
    .first<{ allow_admin_voting: number }>();
  const eligible = (await db.prepare("SELECT COUNT(*) AS n FROM voters WHERE can_vote = 1").first<{ n: number }>())?.n ?? 0;
  if (election?.allow_admin_voting === 0) {
    const admins = (
      await db
        .prepare("SELECT COUNT(*) AS n FROM voters v JOIN admin_voting a ON a.member_id = v.member_id WHERE v.can_vote = 1")
        .first<{ n: number }>()
    )?.n ?? 0;
    return eligible - admins;
  }
  return eligible;
}
