/**
 * Perender Markdown mini untuk konten kandidat (fork). Seluruh teks di-escape
 * lebih dulu, lalu hanya tag yang diketahui dibangun kembali — sehingga HTML
 * yang masuk tidak pernah bisa dieksekusi. URL YouTube pada baris sendiri
 * berubah menjadi embed youtube-nocookie bersandbox (allow-scripts
 * allow-popups, tanpa allow-same-origin sesuai aturan konten kaya).
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

const YOUTUBE_LINE =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})[^\s]*$/;

function youTubeEmbed(id: string): string {
  return `<div class="markdown-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="Video kandidat" loading="lazy" allowfullscreen sandbox="allow-scripts allow-popups" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen"></iframe></div>`;
}

function safeLink(label: string, href: string): string {
  const external = /^https:\/\/(?:[^&"']|&amp;)+$/;
  const internal = /^\/(?:[^&"'\\]|&amp;)+$/;
  if (!external.test(href) && !internal.test(href)) return label;
  const rel = external.test(href) ? ' rel="noopener noreferrer"' : "";
  return `<a href="${href}"${rel}>${label}</a>`;
}

/** Format inline pada teks yang sudah di-escape: kode, tebal, miring, tautan. */
function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => safeLink(label, href));
  return out;
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(`<p>${paragraph.map(inline).join("<br/>")}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
      list = [];
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      blocks.push(`<blockquote>${quote.map(inline).join("<br/>")}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const youtube = YOUTUBE_LINE.exec(line.trim());
    if (youtube) {
      flushAll();
      blocks.push(youTubeEmbed(youtube[1]!));
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const tag = `h${heading[1]!.length + 1}`;
      blocks.push(`<${tag}>${inline(heading[2]!)}</${tag}>`);
      continue;
    }
    const listItem = /^[-*]\s+(.*)$/.exec(line.trim());
    if (listItem) {
      flushParagraph();
      flushQuote();
      list.push(listItem[1]!);
      continue;
    }
    const quoteLine = /^>\s?(.*)$/.exec(line.trim());
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]!);
      continue;
    }
    if (line.trim() === "---") {
      flushAll();
      blocks.push("<hr/>");
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  flushAll();
  return blocks.join("\n");
}

/** Ubah Markdown menjadi ringkasan teks polos untuk daftar kandidat. */
export function markdownToPlain(source: string, maxLength = 160): string {
  const plain = source
    .replace(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?(?:[^#\s]*&)?v=|youtu\.be\/|youtube\.com\/shorts\/)[A-Za-z0-9_-]+\S*/g, "")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*---\s*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1).trimEnd()}…` : plain;
}
