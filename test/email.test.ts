import { describe, expect, it } from "vitest";
import {
  createTransport,
  EmailError,
  buildMimeMessage,
  type EmailAddress,
  type EmailConfig,
  type OutgoingEmail,
  type SmtpConnection,
  type SmtpConnect,
} from "../src/server/email/providers";
import {
  adminInvitationTemplate,
  receiptTemplate,
  reminderTemplate,
  testEmailTemplate,
  type EmailBranding,
  type RenderedEmail,
} from "../src/server/email/templates";

const branding: EmailBranding = {
  siteName: "PPI Okayama",
  logoUrl: "https://pemilu.ppiokayama.jp/api/media/logo-192.png",
  websiteUrl: "https://ppiokayama.jp",
  baseUrl: "https://pemilu.ppiokayama.jp",
};

const electionTitle = "Pemilu Raya PPI Okayama 2026";
const receiptCode = "ABCD-1234-EFGH-5678";

const from: EmailAddress = { name: "Pemilu PPI Okayama", address: "kirim@ppiokayama.jp" };
const to: EmailAddress = { name: "Budi Santoso", address: "budi@example.com" };

function message(subject: string, html: string, text: string): OutgoingEmail {
  return { from, to, subject, html, text };
}

function renderAll(): Record<string, RenderedEmail> {
  return {
    "Tes Email": testEmailTemplate(branding),
    "Undangan Admin Voting": adminInvitationTemplate({
      branding,
      recipientName: "Budi Santoso",
      electionTitle,
      inviteUrl: "https://pemilu.ppiokayama.jp/undangan/token-panjang-72-jam",
      expiresAt: new Date("2026-12-05T05:00:00Z"),
    }),
    "Bukti Suara": receiptTemplate({ branding, recipientName: "Budi Santoso", electionTitle, receiptCode }),
    Pengingat: reminderTemplate({
      branding,
      recipientName: "Budi Santoso",
      electionTitle,
      closesAt: new Date("2026-12-05T05:00:00Z"),
    }),
  };
}

describe("templat email dan layout", () => {
  it("merender keempat templat masing-masing di bawah 20 KB", () => {
    for (const [nama, rendered] of Object.entries(renderAll())) {
      const htmlSize = new TextEncoder().encode(rendered.html).byteLength;
      const textSize = new TextEncoder().encode(rendered.text).byteLength;
      expect(htmlSize, nama).toBeLessThan(20 * 1024);
      expect(textSize, nama).toBeLessThan(20 * 1024);
    }
  });

  it("memakai satu layout berbasis tabel dengan logo 64 px, tanpa pixel pelacak", () => {
    for (const rendered of Object.values(renderAll())) {
      const { html } = rendered;
      expect(html).toContain('width="64" height="64"');
      expect(html).toContain(branding.logoUrl);
      expect(html).toContain("<table");
      expect(html).toContain("style=");
      expect(html).not.toMatch(/tracking|pixel|1x1/i);
      expect(html).not.toContain('width="1"');
    }
  });

  it("menulis footer PPI Okayama dengan tautan situs organisasi", () => {
    const { html } = receiptTemplate({ branding, recipientName: "Budi", electionTitle, receiptCode });
    expect(html).toContain(`href="${branding.websiteUrl}"`);
    expect(html).toContain(`PPI Okayama &#183; ppiokayama.jp`);
  });

  it("tidak memakai tanda seru, emoji, atau membiarkan HTML lolos dari judul", () => {
    for (const rendered of Object.values(renderAll())) {
      const isi = rendered.html.replace("<!DOCTYPE html>", "");
      expect(isi).not.toContain("!");
      expect(rendered.text).not.toContain("!");
      expect(isi).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    const injeksi = receiptTemplate({
      branding,
      recipientName: "Budi",
      electionTitle: "<script>alert(1)</script>",
      receiptCode,
    });
    expect(injeksi.html).not.toContain("<script>");
    expect(injeksi.html).toContain("&lt;script&gt;");
  });

  it("Tes Email menjelaskan bahwa pengaturan sudah benar", () => {
    const rendered = testEmailTemplate(branding);
    expect(rendered.subject).toBe("Tes Email dari PPI Okayama");
    expect(rendered.html).toContain("email percobaan");
    expect(rendered.html).toContain("Undangan Admin Voting, Bukti Suara, dan Pengingat");
  });

  it("Undangan Admin Voting memuat tautan sekali pakai dan batas waktu JST", () => {
    const rendered = adminInvitationTemplate({
      branding,
      recipientName: "Budi Santoso",
      electionTitle,
      inviteUrl: "https://pemilu.ppiokayama.jp/undangan/token-panjang-72-jam",
      expiresAt: new Date("2026-12-05T05:00:00Z"),
    });
    expect(rendered.subject).toBe(`Undangan Admin Voting ${electionTitle}`);
    expect(rendered.html).toContain("Halo Budi Santoso,");
    expect(rendered.html).toContain("Admin Voting");
    expect(rendered.html).toContain('href="https://pemilu.ppiokayama.jp/undangan/token-panjang-72-jam"');
    expect(rendered.html).toContain("Buka Undangan");
    expect(rendered.html).toContain("hanya bisa dipakai satu kali");
    expect(rendered.html).toMatch(/5 Des 2026, 14\.00 JST/);
  });

  it("Bukti Suara memuat kode dan tombol Cek Bukti Suara", () => {
    const rendered = receiptTemplate({ branding, recipientName: "Budi Santoso", electionTitle, receiptCode });
    expect(rendered.subject).toBe(`Bukti Suara untuk ${electionTitle}`);
    expect(rendered.html).toContain(electionTitle);
    expect(rendered.html).toContain(receiptCode);
    expect(rendered.html).toContain(`href="${branding.baseUrl}/surat-suara"`);
    expect(rendered.html).toContain("Cek Bukti Suara");
    expect(rendered.html).toContain("Sistem tidak menyimpan data yang menghubungkan nama Anda dengan pilihan Anda.");
  });

  it("Pengingat menyebut batas waktu dan tombol Pilih Sekarang", () => {
    const rendered = reminderTemplate({
      branding,
      recipientName: "Budi Santoso",
      electionTitle,
      closesAt: new Date("2026-12-05T05:00:00Z"),
    });
    expect(rendered.subject).toBe(`Pengingat: gunakan hak pilih Anda pada ${electionTitle}`);
    expect(rendered.html).toContain("belum memilih");
    expect(rendered.html).toMatch(/5 Des 2026, 14\.00 JST/);
    expect(rendered.html).toContain(`href="${branding.baseUrl}"`);
    expect(rendered.html).toContain("Pilih Sekarang");
  });
});

// ---------------------------------------------------------------------------
// Penyedia HTTP dengan fetch palsu
// ---------------------------------------------------------------------------

type RecordedRequest = { url: string; init: RequestInit };

function recordingFetch(status: number, body: unknown): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, requests };
}

describe("penyedia HTTP", () => {
  it("ZeptoMail: bentuk permintaan, header Zoho-enczapikey, body htmlbody", async () => {
    const { fetchImpl, requests } = recordingFetch(200, { request_id: "ok" });
    const transport = createTransport({ provider: "zeptomail", apiKey: "zepto-token" }, { fetchImpl });
    await transport.send(message("Halo", "<p>Halo</p>", "Halo"));
    expect(requests).toHaveLength(1);
    const { url, init } = requests[0]!;
    expect(url).toBe("https://api.zeptomail.com/v1.1/email");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Zoho-enczapikey zepto-token");
    expect(headers.get("Content-Type")).toBe("application/json");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.subject).toBe("Halo");
    expect(body.htmlbody).toBe("<p>Halo</p>");
    expect(body.textbody).toBe("Halo");
    expect((body.from as Record<string, string>).address).toBe(from.address);
    const penerima = (body.to as Array<{ email_address: Record<string, string> }>)[0]!;
    expect(penerima.email_address.address).toBe(to.address);
  });

  it("Resend: bearer token, from bergaya string, to berupa larik", async () => {
    const { fetchImpl, requests } = recordingFetch(200, { id: "abc" });
    const transport = createTransport({ provider: "resend", apiKey: "re_123" }, { fetchImpl });
    await transport.send(message("Halo", "<p>Halo</p>", "Halo"));
    const { url, init } = requests[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer re_123");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.from).toBe(`${from.name} <${from.address}>`);
    expect(body.to).toEqual([to.address]);
    expect(body.html).toBe("<p>Halo</p>");
  });

  it("Mailgun: basic auth api:key, form-urlencoded, region eu ganti host", async () => {
    const { fetchImpl, requests } = recordingFetch(200, { id: "<1@mg>" });
    const transport = createTransport(
      { provider: "mailgun", apiKey: "mg-key", domain: "mg.ppiokayama.jp", region: "eu" },
      { fetchImpl },
    );
    await transport.send(message("Halo", "<p>Halo</p>", "Halo"));
    const { url, init } = requests[0]!;
    expect(url).toBe("https://api.eu.mailgun.net/v3/mg.ppiokayama.jp/messages");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`Basic ${btoa("api:mg-key")}`);
    expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("from")).toBe(`${from.name} <${from.address}>`);
    expect(form.get("to")).toBe(to.address);
    expect(form.get("html")).toBe("<p>Halo</p>");
  });

  it("peta kesalahan: 401 jadi pesan periksa API key", async () => {
    for (const config of [
      { provider: "zeptomail", apiKey: "x" },
      { provider: "resend", apiKey: "x" },
      { provider: "mailgun", apiKey: "x", domain: "d.example", region: "us" },
    ] as const) {
      const { fetchImpl } = recordingFetch(401, { message: "Unauthorized" });
      const transport = createTransport(config, { fetchImpl });
      const error = await transport.send(message("s", "<p>s</p>", "s")).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EmailError);
      const emailError = error as EmailError;
      expect(emailError.status).toBe(401);
      expect(emailError.message).toMatch(/ditolak \(HTTP 401\)/);
      expect(emailError.message).toContain("API key");
    }
  });

  it("peta kesalahan: 422 menyertakan alasan penyedia, 429 dan 5xx pesannya jelas", async () => {
    const { fetchImpl, requests } = recordingFetch(422, { message: "Domain not verified" });
    const transport = createTransport({ provider: "resend", apiKey: "re_123" }, { fetchImpl });
    const error = (await transport.send(message("s", "<p>s</p>", "s")).catch((e: unknown) => e)) as EmailError;
    expect(error.message).toContain("Domain not verified");
    expect(error.message).toContain("(HTTP 422)");

    const throttle = recordingFetch(429, { message: "rate limited" });
    const slow = createTransport({ provider: "resend", apiKey: "re_123" }, { fetchImpl: throttle.fetchImpl });
    const throttleError = (await slow.send(message("s", "<p>s</p>", "s")).catch((e: unknown) => e)) as EmailError;
    expect(throttleError.message).toContain("membatasi laju");

    const down = recordingFetch(503, { message: "boom" });
    const broken = createTransport({ provider: "mailgun", apiKey: "x", domain: "d.example", region: "us" }, { fetchImpl: down.fetchImpl });
    const downError = (await broken.send(message("s", "<p>s</p>", "s")).catch((e: unknown) => e)) as EmailError;
    expect(downError.message).toContain("sedang bermasalah (HTTP 503)");
    expect(requests).toHaveLength(1);
  });

  it("peta kesalahan: jaringan gagal dan kredensial kosong tidak menelepon penyedia", async () => {
    const networkError: typeof fetch = async () => {
      throw new TypeError("network down");
    };
    const transport = createTransport({ provider: "zeptomail", apiKey: "x" }, { fetchImpl: networkError });
    const error = (await transport.send(message("s", "<p>s</p>", "s")).catch((e: unknown) => e)) as EmailError;
    expect(error.message).toContain("Tidak bisa menghubungi ZeptoMail");

    const { fetchImpl, requests } = recordingFetch(200, {});
    const empty = createTransport({ provider: "resend", apiKey: "" }, { fetchImpl });
    await expect(empty.send(message("s", "<p>s</p>", "s"))).rejects.toThrow("API key Resend belum diisi");
    expect(requests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SMTP dengan socket palsu
// ---------------------------------------------------------------------------

type FakeConnection = SmtpConnection & {
  written: string[];
  address: string;
  secureTransport: string;
};

function scriptedConnection(script: string[], tls?: FakeConnection): FakeConnection {
  const encoder = new TextEncoder();
  const written: string[] = [];
  let next = 0;
  const connection: FakeConnection = {
    written,
    address: "",
    secureTransport: "",
    readable: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (next < script.length) {
          controller.enqueue(encoder.encode(script[next]!));
          next += 1;
        } else {
          controller.close();
        }
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        written.push(new TextDecoder().decode(chunk));
      },
    }),
    startTls() {
      return tls ?? connection;
    },
    close() {
      return Promise.resolve();
    },
  };
  return connection;
}

function fakeSmtpConnect(plain: FakeConnection): SmtpConnect {
  return (address, options) => {
    plain.address = address;
    plain.secureTransport = options.secureTransport;
    return plain;
  };
}

const smtpConfig = {
  provider: "smtp",
  host: "smtp.ppiokayama.jp",
  port: 465 as 465 | 587,
  username: "kirim@ppiokayama.jp",
  password: "rahasia",
} satisfies Extract<EmailConfig, { provider: "smtp" }>;

/** Base64 UTF-8 seperti implementasi produksi; btoa murni menolak non-Latin1. */
function base64Utf8(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

describe("transport SMTP", () => {
  it("port 465: TLS langsung, urutan EHLO, AUTH LOGIN, MAIL, RCPT, DATA, QUIT", async () => {
    const plain = scriptedConnection([
      "220 smtp siap\r\n",
      "250-smtp.ppiokayama.jp\r\n250-AUTH LOGIN\r\n250 OK\r\n",
      "334 VXNlcm5hbWU6\r\n",
      "334 UGFzc3dvcmQ6\r\n",
      "235 2.7.0 diterima\r\n",
      "250 2.1.0 OK\r\n",
      "250 2.1.5 OK\r\n",
      "354 mulai kirim\r\n",
      "250 2.0.0 tersimpan\r\n",
      "221 2.0.0 sampai jumpa\r\n",
    ]);
    const transport = createTransport(smtpConfig, { connect: fakeSmtpConnect(plain) });
    await transport.send(message("Kuitansi", "<p>kuitansi</p>", "kuitansi"));
    expect(plain.secureTransport).toBe("on");
    expect(plain.address).toBe("smtp.ppiokayama.jp:465");
    const written = plain.written.join("");
    expect(written).toContain("EHLO ppiokayama.jp\r\n");
    expect(written).toContain("AUTH LOGIN\r\n");
    expect(written).toContain(`${base64Utf8(smtpConfig.username)}\r\n`);
    expect(written).toContain(`${base64Utf8(smtpConfig.password)}\r\n`);
    expect(written).toContain(`MAIL FROM:<${from.address}>\r\n`);
    expect(written).toContain(`RCPT TO:<${to.address}>\r\n`);
    expect(written).toContain("DATA\r\n");
    expect(written).toContain("QUIT\r\n");
    const payload = plain.written.find((chunk) => chunk.includes("MIME-Version"));
    expect(payload).toBeDefined();
    expect(payload).toContain("Subject: Kuitansi");
    expect(payload!.endsWith("\r\n.\r\n")).toBe(true);
    expect(payload).toContain(base64Utf8("kuitansi"));
  });

  it("port 587: mulai dengan STARTTLS lalu EHLO ulang di dalam TLS", async () => {
    const tls = scriptedConnection([
      "250-smtp\r\n250 AUTH LOGIN\r\n",
      "334\r\n",
      "334\r\n",
      "235 2.7.0 ok\r\n",
      "250 OK\r\n",
      "250 OK\r\n",
      "354 go\r\n",
      "250 OK\r\n",
      "221 bye\r\n",
    ]);
    const plain = scriptedConnection(
      ["220 smtp siap\r\n", "250-smtp\r\n250 STARTTLS\r\n", "220 2.0.0 siap TLS\r\n"],
      tls,
    );
    const transport = createTransport({ ...smtpConfig, port: 587 }, { connect: fakeSmtpConnect(plain) });
    await transport.send(message("Pengingat", "<p>isi</p>", "isi"));
    expect(plain.secureTransport).toBe("starttls");
    expect(plain.address).toBe("smtp.ppiokayama.jp:587");
    expect(plain.written.join("")).toContain("STARTTLS\r\n");
    expect(tls.written.join("")).toContain("EHLO ppiokayama.jp\r\n");
    expect(tls.written.join("")).toContain("AUTH LOGIN\r\n");
    expect(plain.written.join("")).not.toContain("AUTH LOGIN");
  });

  it("menolak kredensial salah (535) dengan pesan perbaikan", async () => {
    const plain = scriptedConnection([
      "220 smtp siap\r\n",
      "250 smtp\r\n",
      "334\r\n",
      "334\r\n",
      "535 5.7.8 kredensial salah\r\n",
    ]);
    const transport = createTransport(smtpConfig, { connect: fakeSmtpConnect(plain) });
    const error = await transport.send(message("s", "<p>s</p>", "s")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailError);
    expect((error as EmailError).status).toBe(535);
    expect((error as EmailError).message).toContain("kata sandi SMTP ditolak");
  });

  it("menolak penerima ditolak (550) dan konfigurasi kosong", async () => {
    const plain = scriptedConnection([
      "220 smtp siap\r\n",
      "250 smtp\r\n",
      "334\r\n",
      "334\r\n",
      "235 ok\r\n",
      "250 OK\r\n",
      "550 5.1.1 alamat tidak dikenal\r\n",
    ]);
    const transport = createTransport(smtpConfig, { connect: fakeSmtpConnect(plain) });
    const error = (await transport.send(message("s", "<p>s</p>", "s")).catch((e: unknown) => e)) as EmailError;
    expect(error.status).toBe(550);
    expect(error.message).toContain("alamat penerima");

    const invalid = createTransport(
      // Pemeriksaan port berjalan saat runtime; uji nilai ilegal lewat cast.
      { ...smtpConfig, port: 25 as 465 | 587 },
      { connect: fakeSmtpConnect(plain) },
    );
    await expect(invalid.send(message("s", "<p>s</p>", "s"))).rejects.toThrow("Port SMTP harus 465");
    const tanpaHost = createTransport({ ...smtpConfig, host: "" }, { connect: fakeSmtpConnect(plain) });
    await expect(tanpaHost.send(message("s", "<p>s</p>", "s"))).rejects.toThrow("Server SMTP belum diisi");
  });

  it("buildMimeMessage: multipart/alternative dengan dua bagian base64", () => {
    const mime = buildMimeMessage(message("Kuitansi <baik>", "<p>isi <b>tebal</b></p>", "isi tebal"));
    expect(mime).toMatch(/^From: "Pemilu PPI Okayama" <kirim@ppiokayama\.jp>\r\n/);
    expect(mime).toContain("Subject: Kuitansi <baik>\r\n");
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="ppij-');
    expect(mime).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(mime).toContain("Content-Type: text/html; charset=UTF-8");
    expect(mime).toContain(base64Utf8("isi tebal"));
    expect(mime).toContain(base64Utf8("<p>isi <b>tebal</b></p>"));
    expect(mime.endsWith("--\r\n")).toBe(true);
  });

  it("Subject dan nama non-ASCII dikodekan UTF-8 base64", () => {
    const mime = buildMimeMessage(message("Undangan Admin Voting — Pemilu", "<p>isi</p>", "isi"));
    expect(mime).toContain(`Subject: =?UTF-8?B?${base64Utf8("Undangan Admin Voting — Pemilu")}?=\r\n`);
  });
});
