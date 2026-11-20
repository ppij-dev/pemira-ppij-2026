import { describe, expect, it } from "vitest";
import profile from "../src/pages/kandidat/[slug].astro?raw";
import adminKandidat from "../src/pages/admin/kandidat.astro?raw";
import ballot from "../src/pages/pilih-suara.astro?raw";
import inviteWelcome from "../src/pages/undangan/[kode].astro?raw";
import inviteBallot from "../src/pages/undangan/[kode]/surat-suara.astro?raw";

// Portal kampanye kandidat (keputusan pemilik 2026-11-20): halaman kampanye tim
// kandidat tampil tersemat hanya di halaman profil, di dalam iframe ber-sandbox
// tanpa allow-same-origin. Surat suara, lembar konfirmasi, dan halaman undangan
// tidak pernah menyematkannya. Perilaku tombolnya diuji di peramban (screenshot),
// di sini hanya isi sumber halaman.
const SANDBOX = 'sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"';

describe("portal kampanye kandidat di halaman profil", () => {
  it("menyematkan tautan kandidat dengan sandbox yang tepat", () => {
    expect(profile).toContain(SANDBOX);
    expect(profile).toContain('referrerpolicy="no-referrer"');
    expect(profile).toContain('loading="lazy"');
    expect(profile).toContain("title={`Portal kampanye ${candidate.nickname}`}");
    // Tanpa allow-same-origin bingkai tidak dapat menyentuh cookie, penyimpanan,
    // atau DOM situs ini; tanpa allow-top-navigation ia tidak dapat memindahkan tab.
    expect(profile).not.toContain("allow-same-origin");
    expect(profile).not.toContain("allow-top-navigation");
    expect(profile).not.toContain("allow-forms");
  });

  it("menampilkan judul, catatan atribusi dan tautan cadangan di luar bingkai", () => {
    expect(profile).toContain(">Portal kampanye</h2>");
    expect(profile).toContain("disiapkan oleh tim kandidat, bukan oleh panitia pemilihan");
    expect(profile).toContain("Jika halaman tidak tampil, buka di tab baru.");
    expect(profile).toContain('target="_blank" rel="noopener noreferrer"');
    expect(profile).toContain("Buka di tab baru");
    // Tautan cadangan berada di luar iframe dan setinggi target sentuh minimum.
    expect(profile).toContain("min-h-11 items-center gap-2");
  });

  it("memakai tinggi responsif yang panjang di ponsel 390 px", () => {
    expect(profile).toContain("h-[clamp(520px,78dvh,900px)]");
    expect(profile).toContain("w-full border-0");
  });

  it("hanya merender bagian saat alamat kampanye terisi", () => {
    expect(profile).toContain('const campaignUrl = typeof candidate?.campaign_url === "string"');
    expect(profile).toContain('{campaignUrl && <section aria-labelledby="campaign-heading"');
    // Hanya satu iframe portal kampanye di halaman profil.
    expect(profile.match(/sandbox="allow-scripts/g)?.length).toBe(1);
  });

  it("memuat alamat kampanye dari proyeksi profil, bukan dari parameter URL", () => {
    expect(profile).not.toContain("Astro.url.searchParams.get(\"kampanye\")");
    expect(profile).toContain("candidate?.campaign_url");
  });
});

describe("portal kampanye kandidat di halaman Admin Voting", () => {
  it("menyediakan medan opsional dan mengirimkannya bersama kandidat", () => {
    expect(adminKandidat).toContain('label="Portal kampanye (opsional)"');
    expect(adminKandidat).toContain('id="candidate-campaign-url"');
    expect(adminKandidat).toContain('name="campaign_url"');
    expect(adminKandidat).toContain('maxlength="300"');
    expect(adminKandidat).toContain("Tampil tersemat di halaman profil kandidat, bukan di surat suara.");
  });

  it("mengisi ulang medan saat kandidat diubah", () => {
    expect(adminKandidat).toContain("c.campaign_url");
    expect(adminKandidat).toContain("data-campaign-url={c.campaign_url || ''}");
    expect(adminKandidat).toContain("form.elements.campaign_url");
  });
});

describe("portal kampanye tidak pernah ikut ke alur pemungutan suara", () => {
  it("surat suara dan lembar konfirmasi tidak menyematkan halaman kampanye", () => {
    for (const page of [ballot, inviteBallot]) {
      expect(page).not.toContain("Portal kampanye");
      expect(page).not.toContain("campaign_url");
      expect(page).not.toContain(SANDBOX);
    }
  });

  it("halaman undangan menautkan profil alih-alih menyematkan halaman kampanye", () => {
    expect(inviteWelcome).not.toContain("Portal kampanye");
    expect(inviteWelcome).not.toContain("campaign_url");
    expect(inviteWelcome).not.toContain(SANDBOX);
    // Tautan ke profil tetap ada, sehingga portal kampanye dibuka di sana.
    expect(inviteWelcome).toContain("candidateProfileHref");
    expect(inviteWelcome).toContain("Buka profil lengkap");
  });
});
