/**
 * Pengiriman email untuk task 9.3 (design.md keputusan 10).
 * Tiga penyedia HTTP lewat fetch (ZeptoMail, Resend, Mailgun) dan SMTP over TLS
 * di port 465/587 lewat cloudflare:sockets. Semua kesalahan dipetakan ke EmailError
 * dengan pesan Bahasa Indonesia yang menjelaskan langkah perbaikan, tanpa pernah
 * menampilkan kata sandi atau API key.
 *
 * Kode SMTP terisolasi di belakang SmtpConnect sehingga test bisa memalsukan
 * socket (lihat test/email.test.ts); implementasi asli hanya memanggil
 * cloudflare:sockets di defaultSmtpConnect.
 */

/// <reference types="@cloudflare/workers-types" />
import { connect } from "cloudflare:sockets";

export type EmailProviderName = "zeptomail" | "resend" | "mailgun" | "smtp";

export type EmailAddress = {
  name?: string;
  address: string;
};

export type OutgoingEmail = {
  from: EmailAddress;
  to: EmailAddress;
  subject: string;
  html: string;
  text: string;
};

export type EmailConfig =
  | { provider: "zeptomail"; apiKey: string }
  | { provider: "resend"; apiKey: string }
  | { provider: "mailgun"; apiKey: string; domain: string; region: "us" | "eu" }
  | { provider: "smtp"; host: string; port: 465 | 587; username: string; password: string };

/** Kesalahan kirim email yang aman ditampilkan ke Admin Voting. */
export class EmailError extends Error {
  readonly provider: EmailProviderName;
  /** Kode HTTP penyedia atau kode balasan SMTP, bila ada. */
  readonly status?: number;

  constructor(provider: EmailProviderName, message: string, status?: number) {
    super(message);
    this.name = "EmailError";
    this.provider = provider;
    this.status = status;
  }
}

export type EmailTransport = {
  send(message: OutgoingEmail): Promise<void>;
};

/** Pengganti dependensi untuk pengujian: fetch palsu dan socket palsu. */
export type TransportDeps = {
  fetchImpl?: typeof fetch;
  connect?: SmtpConnect;
};

// ---------------------------------------------------------------------------
// Penyedia HTTP
// ---------------------------------------------------------------------------

function headerText(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").trim();
}

function providerLabel(provider: EmailProviderName): string {
  if (provider === "smtp") return "Server SMTP";
  if (provider === "zeptomail") return "ZeptoMail";
  if (provider === "resend") return "Resend";
  return "Mailgun";
}

async function errorMessageBody(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: { message?: string } };
    return (parsed.message ?? parsed.error?.message ?? raw).trim().slice(0, 200);
  } catch {
    return raw.trim().slice(0, 200);
  }
}

async function mapHttpError(provider: EmailProviderName, response: Response): Promise<EmailError> {
  const label = providerLabel(provider);
  const detail = await errorMessageBody(response);
  const { status } = response;
  if (status === 401 || status === 403) {
    return new EmailError(
      provider,
      `Kredensial ${label} ditolak (HTTP ${status}). Periksa API key di Pengaturan, bagian Email, lalu kirim Email Tes lagi.`,
      status,
    );
  }
  if (status === 429) {
    return new EmailError(
      provider,
      `${label} membatasi laju pengiriman (HTTP 429). Tunggu beberapa menit, lalu coba lagi.`,
      status,
    );
  }
  if (status >= 500) {
    return new EmailError(
      provider,
      `Server ${label} sedang bermasalah (HTTP ${status}). Coba lagi nanti.`,
      status,
    );
  }
  return new EmailError(
    provider,
    `${label} menolak email ini (HTTP ${status})${detail ? `: ${detail}` : "."} Periksa alamat pengirim dan penerima di Pengaturan.`,
    status,
  );
}

async function post(provider: EmailProviderName, deps: TransportDeps, url: string, headers: Record<string, string>, body: string): Promise<void> {
  const label = providerLabel(provider);
  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(url, { method: "POST", headers, body });
  } catch {
    throw new EmailError(
      provider,
      `Tidak bisa menghubungi ${label}. Periksa koneksi jaringan atau konfigurasi penyedia email.`,
    );
  }
  if (!response.ok) {
    throw await mapHttpError(provider, response);
  }
}

function zeptomailTransport(config: { apiKey: string }, deps: TransportDeps): EmailTransport {
  return {
    async send(message: OutgoingEmail): Promise<void> {
      if (!config.apiKey) {
        throw new EmailError("zeptomail", "API key ZeptoMail belum diisi. Lengkapi di Pengaturan, bagian Email, lalu kirim Email Tes.");
      }
      const body = {
        from: { address: message.from.address, name: message.from.name ?? "" },
        to: [{ email_address: { address: message.to.address, name: message.to.name ?? "" } }],
        subject: message.subject,
        htmlbody: message.html,
        textbody: message.text,
      };
      await post(
        "zeptomail",
        deps,
        "https://api.zeptomail.com/v1.1/email",
        { Authorization: `Zoho-enczapikey ${config.apiKey}`, "Content-Type": "application/json" },
        JSON.stringify(body),
      );
    },
  };
}

function withDisplayName(address: EmailAddress): string {
  return address.name ? `${address.name} <${address.address}>` : address.address;
}

function resendTransport(config: { apiKey: string }, deps: TransportDeps): EmailTransport {
  return {
    async send(message: OutgoingEmail): Promise<void> {
      if (!config.apiKey) {
        throw new EmailError("resend", "API key Resend belum diisi. Lengkapi di Pengaturan, bagian Email, lalu kirim Email Tes.");
      }
      const body = {
        from: withDisplayName(message.from),
        to: [message.to.address],
        subject: message.subject,
        html: message.html,
        text: message.text,
      };
      await post(
        "resend",
        deps,
        "https://api.resend.com/emails",
        { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        JSON.stringify(body),
      );
    },
  };
}

function mailgunTransport(config: { apiKey: string; domain: string; region: "us" | "eu" }, deps: TransportDeps): EmailTransport {
  return {
    async send(message: OutgoingEmail): Promise<void> {
      if (!config.apiKey || !config.domain) {
        throw new EmailError("mailgun", "API key atau domain Mailgun belum lengkap. Lengkapi di Pengaturan, bagian Email, lalu kirim Email Tes.");
      }
      const base = config.region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
      const form = new URLSearchParams({
        from: withDisplayName(message.from),
        to: message.to.address,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      await post(
        "mailgun",
        deps,
        `${base}/v3/${encodeURIComponent(config.domain)}/messages`,
        { Authorization: `Basic ${btoa(`api:${config.apiKey}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        form.toString(),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// SMTP over TLS (port 465) dan STARTTLS (port 587) via cloudflare:sockets
// ---------------------------------------------------------------------------

export type SmtpConnectOptions = { secureTransport: "on" | "starttls" };

/** Koneksi minimal yang dibutuhkan sesi SMTP; dipalsukan di pengujian. */
export type SmtpConnection = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  startTls(options?: { expectedServerHostname?: string }): SmtpConnection;
  close(): Promise<void> | void;
};

export type SmtpConnect = (
  address: string,
  options: SmtpConnectOptions,
) => Promise<SmtpConnection> | SmtpConnection;

// Socket asli hanya dibuka di runtime Workers (tes memalsukan SmtpConnect,
// jadi test/email.test.ts tidak pernah menyentuh cloudflare:sockets).
async function defaultSmtpConnect(address: string, options: SmtpConnectOptions): Promise<SmtpConnection> {
  const socket = connect(address, { secureTransport: options.secureTransport, allowHalfOpen: false });
  // Socket workerd memenuhi bentuk SmtpConnection; tipe pustaka berbeda sumber.
  return socket as unknown as SmtpConnection;
}

type SmtpStep = "sapaan" | "ehlo" | "starttls" | "auth" | "mail" | "rcpt" | "data" | "akhir";

class SmtpChannel {
  private reader: { read(): Promise<{ value: Uint8Array | undefined; done: boolean }> };
  private writer: { write(chunk: Uint8Array): Promise<void> };
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();

  constructor(connection: SmtpConnection) {
    this.reader = connection.readable.getReader();
    this.writer = connection.writable.getWriter();
  }

  /** Setelah STARTTLS, lanjutkan dengan stream hasil TLS. */
  upgrade(connection: SmtpConnection): void {
    this.reader = connection.readable.getReader();
    this.writer = connection.writable.getWriter();
    this.buffer = "";
  }

  async writeLine(line: string): Promise<void> {
    await this.writer.write(this.encoder.encode(`${line}\r\n`));
  }

  async writeRaw(payload: string): Promise<void> {
    await this.writer.write(this.encoder.encode(payload));
  }

  /** Membaca balasan sampai baris akhir (kode + spasi atau kode saja). */
  async readReply(): Promise<{ code: number; text: string }> {
    for (;;) {
      const lineEnd = this.buffer.indexOf("\r\n");
      if (lineEnd === -1) {
        const { value, done } = await this.reader.read();
        if (done || !value) {
          throw new EmailError("smtp", "Koneksi ke server SMTP terputus sebelum pengiriman selesai.");
        }
        this.buffer += this.decoder.decode(value, { stream: true });
        continue;
      }
      const line = this.buffer.slice(0, lineEnd);
      this.buffer = this.buffer.slice(lineEnd + 2);
      if (/^\d{3}[ -]/.test(line) || /^\d{3}$/.test(line)) {
        const code = Number(line.slice(0, 3));
        const text = line.length > 3 ? line.slice(4) : "";
        if (line.charAt(3) !== "-") {
          return { code, text };
        }
      }
    }
  }
}

function smtpFailure(step: SmtpStep, reply: { code: number; text: string }, host: string): EmailError {
  const { code, text } = reply;
  const status = code;
  if (step === "auth") {
    return new EmailError(
      "smtp",
      `Nama pengguna atau kata sandi SMTP ditolak server (kode ${code}). Periksa ulang di Pengaturan, bagian Email, lalu kirim Email Tes lagi.`,
      status,
    );
  }
  if (step === "rcpt") {
    return new EmailError(
      "smtp",
      `Server email menolak alamat penerima (kode ${code}${text ? `: ${text}` : ""}). Periksa alamat email penerima.`,
      status,
    );
  }
  if (step === "starttls") {
    return new EmailError(
      "smtp",
      `Server SMTP tidak mau melakukan TLS (kode ${code}). Gunakan port 465 atau 587 dengan TLS aktif.`,
      status,
    );
  }
  if (code >= 500) {
    return new EmailError(
      "smtp",
      `Server SMTP di ${host} menolak pengiriman (kode ${code}). Periksa pengaturan SMTP di Pengaturan.`,
      status,
    );
  }
  return new EmailError(
    "smtp",
    `Server SMTP di ${host} menjawab tidak terduga (kode ${code}) pada langkah ${step}. Coba lagi, atau periksa pengaturan SMTP.`,
    status,
  );
}

async function expectReply(channel: SmtpChannel, expected: number, step: SmtpStep, host: string): Promise<void> {
  const reply = await channel.readReply();
  if (reply.code !== expected) {
    throw smtpFailure(step, reply, host);
  }
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function wrapBase64(value: string): string {
  const lines: string[] = [];
  for (let offset = 0; offset < value.length; offset += 76) {
    lines.push(value.slice(offset, offset + 76));
  }
  return lines.join("\r\n");
}

function encodeHeaderValue(value: string): string {
  const safe = headerText(value);
  if (/^[\x20-\x7e]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${toBase64(safe)}?=`;
}

function formatAddress(address: EmailAddress): string {
  const email = headerText(address.address);
  const name = (address.name ?? "").replaceAll(/[\r\n"]+/g, "").trim();
  if (!name) return email;
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name}" <${email}>`;
  return `=?UTF-8?B?${toBase64(name)}?= <${email}>`;
}

function randomHex(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return [...raw].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rfc5322Date(date: Date): string {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad2 = (value: number) => String(value).padStart(2, "0");
  return (
    `${DAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())} +0000`
  );
}

/** Susun pesan MIME multipart/alternative (teks + HTML, base64, aman 7-bit). */
export function buildMimeMessage(message: OutgoingEmail): string {
  const boundary = `ppij-${randomHex(12)}`;
  const senderDomain = message.from.address.includes("@") ? message.from.address.split("@")[1] ?? "localhost" : "localhost";
  const parts = [
    `From: ${formatAddress(message.from)}`,
    `To: ${formatAddress(message.to)}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${rfc5322Date(new Date())}`,
    `Message-ID: <${randomHex(12)}@${senderDomain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(toBase64(message.text)),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(toBase64(message.html)),
    "",
    `--${boundary}--`,
    "",
  ];
  return parts.join("\r\n");
}

function smtpTransport(
  config: { host: string; port: 465 | 587; username: string; password: string },
  deps: TransportDeps,
): EmailTransport {
  return {
    async send(message: OutgoingEmail): Promise<void> {
      if (!config.host) {
        throw new EmailError("smtp", "Server SMTP belum diisi. Lengkapi di Pengaturan, bagian Email.");
      }
      if (config.port !== 465 && config.port !== 587) {
        throw new EmailError("smtp", "Port SMTP harus 465 (TLS) atau 587 (STARTTLS) dengan enkripsi aktif.");
      }
      if (!config.username || !config.password) {
        throw new EmailError("smtp", "Nama pengguna atau kata sandi SMTP belum diisi. Lengkapi di Pengaturan, bagian Email.");
      }
      const connect = deps.connect ?? defaultSmtpConnect;
      const connection = await connect(`${config.host}:${config.port}`, {
        secureTransport: config.port === 465 ? "on" : "starttls",
      });
      const channel = new SmtpChannel(connection);
      try {
        await expectReply(channel, 220, "sapaan", config.host);
        const ehloName = message.from.address.includes("@")
          ? message.from.address.split("@")[1] ?? "localhost"
          : "localhost";
        const ehlo = `EHLO ${ehloName}`;
        await channel.writeLine(ehlo);
        await expectReply(channel, 250, "ehlo", config.host);
        if (config.port === 587) {
          await channel.writeLine("STARTTLS");
          await expectReply(channel, 220, "starttls", config.host);
          channel.upgrade(connection.startTls());
          await channel.writeLine(ehlo);
          await expectReply(channel, 250, "ehlo", config.host);
        }
        await channel.writeLine("AUTH LOGIN");
        await expectReply(channel, 334, "auth", config.host);
        await channel.writeLine(toBase64(config.username));
        await expectReply(channel, 334, "auth", config.host);
        await channel.writeLine(toBase64(config.password));
        await expectReply(channel, 235, "auth", config.host);
        await channel.writeLine(`MAIL FROM:<${headerText(message.from.address)}>`);
        await expectReply(channel, 250, "mail", config.host);
        await channel.writeLine(`RCPT TO:<${headerText(message.to.address)}>`);
        await expectReply(channel, 250, "rcpt", config.host);
        await channel.writeLine("DATA");
        await expectReply(channel, 354, "data", config.host);
        await channel.writeRaw(`${buildMimeMessage(message)}\r\n.\r\n`);
        await expectReply(channel, 250, "data", config.host);
        await channel.writeLine("QUIT");
        await expectReply(channel, 221, "akhir", config.host);
      } finally {
        try {
          await connection.close();
        } catch {
          // Socket mungkin sudah tertutup server; biarkan proses kirim tetap dinilai.
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------

/** Pilih transport sesuai konfigurasi yang tersimpan terenkripsi di Pengaturan. */
export function createTransport(config: EmailConfig, deps: TransportDeps = {}): EmailTransport {
  switch (config.provider) {
    case "zeptomail":
      return zeptomailTransport(config, deps);
    case "resend":
      return resendTransport(config, deps);
    case "mailgun":
      return mailgunTransport(config, deps);
    case "smtp":
      return smtpTransport(config, deps);
  }
}
