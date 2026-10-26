/**
 * Perender konten kandidat (HTML terfilter + dukungan Markdown).
 * Tag HTML artikel yang aman (heading, paragraf, daftar, kutipan, gambar,
 * tautan, serta iframe embed HTTPS dari YouTube/SlideShare/Vimeo) dipertahankan
 * dengan atribut tervalidasi; tag atau atribut berbahaya (script, event
 * handler on*, javascript: URL) selalu di-escape atau dinetralkan.
 *
 * Catatan: iframe pihak ketiga (youtube.com, youtube-nocookie.com,
 * slideshare.net) sudah lintas-origin terhadap situs pemilihan, sehingga
 * tidak boleh diberi atribut sandbox tanpa allow-same-origin yang membuat
 * pemutar video YouTube gagal berjalan.
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
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})[^\s]*$/;

const SAFE_HREF = /^(?:https?:\/\/|\/)[^\s"'<>]*$/i;
const SAFE_IMG_SRC = /^(?:https?:\/\/[^\s"'<>]+|\/[A-Za-z0-9._/\-]+)$/i;
const SAFE_IFRAME_SRC =
  /^https:\/\/(?:(?:www\.)?youtube\.com\/embed\/|(?:www\.)?youtube-nocookie\.com\/embed\/|(?:www\.)?slideshare\.net\/slideshow\/embed_code\/|player\.vimeo\.com\/video\/|docs\.google\.com\/|drive\.google\.com\/|open\.spotify\.com\/embed\/)[A-Za-z0-9_\-./?&=%+:]+$/i;

const BLOCK_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "div",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "figure",
  "figcaption",
  "hr",
  "iframe",
]);

const INLINE_TAGS = new Set([
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "span",
  "small",
  "sub",
  "sup",
  "mark",
  "a",
  "img",
  "br",
]);

const SAFE_STYLE_PROPS = new Set([
  "border",
  "border-width",
  "border-style",
  "border-color",
  "border-radius",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "width",
  "height",
  "max-width",
  "max-height",
  "min-width",
  "min-height",
  "aspect-ratio",
  "text-align",
  "display",
]);

function parseAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rawAttrs)) !== null) {
    const name = match[1]!.toLowerCase();
    if (name.startsWith("on")) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = value;
  }
  return attrs;
}

function hasEventHandlerAttr(rawAttrs: string): boolean {
  return /(?:^|[\s"'/])on[a-z]+\s*=/i.test(rawAttrs);
}

function sanitizeStyle(raw: string | undefined): string {
  if (!raw) return "";
  const clean: string[] = [];
  for (const decl of raw.split(";")) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const prop = trimmed.slice(0, colon).trim().toLowerCase();
    const val = trimmed.slice(colon + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    if (!/^[A-Za-z0-9\s#%.,()-]+$/.test(val)) continue;
    if (/url\s*\(|expression\s*\(|javascript:|vbscript:|data:|import/i.test(val)) continue;
    clean.push(`${prop}: ${val}`);
  }
  return clean.join("; ");
}

function sanitizeDimension(val: string | undefined): string {
  if (!val) return "";
  const trimmed = val.trim();
  return /^\d{1,4}%?$/.test(trimmed) ? trimmed : "";
}

/**
 * Embed YouTube langsung yang dapat diputar di halaman profil kandidat,
 * ditambah tautan cadangan untuk membuka di tab baru.
 */
function youTubeEmbed(id: string): string {
  return `<div class="markdown-video"><iframe src="https://www.youtube.com/embed/${id}" title="Video kandidat" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div><a class="markdown-video-open" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">Tonton di YouTube</a>`;
}

function safeLink(label: string, href: string): string {
  const trimmed = href.trim();
  if (!SAFE_HREF.test(trimmed)) return label;
  const external = /^https?:\/\//i.test(trimmed);
  const rel = external ? ' target="_blank" rel="noopener noreferrer"' : "";
  return `<a href="${escapeHtml(trimmed)}"${rel}>${label}</a>`;
}

interface HtmlToken {
  html: string;
  tag: string;
  closing: boolean;
  selfClosing: boolean;
  isBlock: boolean;
}

function sanitizeIframeTag(rawAttrs: string): string | null {
  if (hasEventHandlerAttr(rawAttrs)) return null;
  const attrs = parseAttributes(rawAttrs);
  let src = (attrs.src ?? "").trim();
  const ytWatch = YOUTUBE_LINE.exec(src);
  if (ytWatch && !/\/embed\//i.test(src)) {
    src = `https://www.youtube.com/embed/${ytWatch[1]!}`;
  }
  if (!SAFE_IFRAME_SRC.test(src)) return null;

  const isYouTube = /^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\//i.test(src);
  const out: string[] = [`src="${escapeHtml(src)}"`];
  const width = sanitizeDimension(attrs.width);
  const height = sanitizeDimension(attrs.height);
  if (width) out.push(`width="${width}"`);
  if (height) out.push(`height="${height}"`);
  out.push(`title="${escapeHtml(attrs.title?.trim() || (isYouTube ? "Video kandidat" : "Konten tersemat"))}"`);
  if (attrs.frameborder === "0") out.push('frameborder="0"');
  if (attrs.marginwidth === "0") out.push('marginwidth="0"');
  if (attrs.marginheight === "0") out.push('marginheight="0"');
  if (attrs.scrolling === "no" || attrs.scrolling === "yes") out.push(`scrolling="${attrs.scrolling}"`);
  const style = sanitizeStyle(attrs.style);
  if (style) out.push(`style="${escapeHtml(style)}"`);
  const allow = isYouTube
    ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
    : "fullscreen";
  out.push(`allow="${allow}"`);
  out.push('referrerpolicy="strict-origin-when-cross-origin"');
  out.push("allowfullscreen");
  out.push('loading="lazy"');
  return `<iframe ${out.join(" ")}></iframe>`;
}

function tokenizeSafeHtml(source: string): { text: string; tokens: HtmlToken[] } {
  const tokens: HtmlToken[] = [];
  const addToken = (token: HtmlToken): string => {
    const id = tokens.length;
    tokens.push(token);
    return `\u0000T${id}\u0000`;
  };

  // 1. Tangani pasangan <iframe ...>...</iframe> sebagai satu unit blok.
  let working = source.replace(/<iframe\b([^>]*)>[\s\S]*?<\/iframe>/gi, (full, rawAttrs: string) => {
    const clean = sanitizeIframeTag(rawAttrs);
    if (!clean) return full;
    return addToken({
      html: clean,
      tag: "iframe",
      closing: false,
      selfClosing: true,
      isBlock: true,
    });
  });

  // 2. Tangani tag HTML lain yang diizinkan.
  const anchorStack: boolean[] = [];
  working = working.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*|\s*\/?)>/g, (full, slash: string, rawName: string, rawRest: string) => {
    const isClosing = slash === "/";
    const lower = rawName.toLowerCase();
    const isBlock = BLOCK_TAGS.has(lower);
    const isInline = INLINE_TAGS.has(lower);
    if (!isBlock && !isInline) return full;
    if (lower === "iframe") return full;

    const normalizedTag = lower === "h1" ? "h2" : lower;

    if (isClosing) {
      if (lower === "img" || lower === "br" || lower === "hr") return "";
      if (lower === "a") {
        const validOpen = anchorStack.pop();
        if (!validOpen) return addToken({ html: "", tag: "a", closing: true, selfClosing: true, isBlock: false });
      }
      return addToken({
        html: `</${normalizedTag}>`,
        tag: normalizedTag,
        closing: true,
        selfClosing: false,
        isBlock,
      });
    }

    if (hasEventHandlerAttr(rawRest)) return full;
    const attrs = parseAttributes(rawRest);

    if (lower === "br") {
      return addToken({ html: "<br/>", tag: "br", closing: false, selfClosing: true, isBlock: false });
    }
    if (lower === "hr") {
      return addToken({ html: "<hr/>", tag: "hr", closing: false, selfClosing: true, isBlock: true });
    }
    if (lower === "img") {
      const src = (attrs.src ?? "").trim();
      if (!SAFE_IMG_SRC.test(src)) return full;
      const out: string[] = [`src="${escapeHtml(src)}"`, `alt="${escapeHtml(attrs.alt ?? "")}"`];
      if (attrs.title) out.push(`title="${escapeHtml(attrs.title)}"`);
      const width = sanitizeDimension(attrs.width);
      const height = sanitizeDimension(attrs.height);
      if (width) out.push(`width="${width}"`);
      if (height) out.push(`height="${height}"`);
      const style = sanitizeStyle(attrs.style);
      if (style) out.push(`style="${escapeHtml(style)}"`);
      out.push('loading="lazy"');
      return addToken({
        html: `<img ${out.join(" ")} />`,
        tag: "img",
        closing: false,
        selfClosing: true,
        isBlock: false,
      });
    }
    if (lower === "a") {
      const href = (attrs.href ?? "").trim();
      if (!SAFE_HREF.test(href)) {
        anchorStack.push(false);
        return addToken({ html: "", tag: "a", closing: false, selfClosing: true, isBlock: false });
      }
      anchorStack.push(true);
      const out: string[] = [`href="${escapeHtml(href)}"`];
      if (attrs.title) out.push(`title="${escapeHtml(attrs.title)}"`);
      const external = /^https?:\/\//i.test(href) || attrs.target === "_blank";
      if (external) {
        out.push('target="_blank"');
        out.push('rel="noopener noreferrer"');
      }
      return addToken({
        html: `<a ${out.join(" ")}>`,
        tag: "a",
        closing: false,
        selfClosing: false,
        isBlock: false,
      });
    }

    const extra: string[] = [];
    if (attrs.class && /^[A-Za-z0-9_\-\s]+$/.test(attrs.class)) {
      extra.push(`class="${escapeHtml(attrs.class.trim())}"`);
    }
    const style = sanitizeStyle(attrs.style);
    if (style) {
      extra.push(`style="${escapeHtml(style)}"`);
    }
    const attrStr = extra.length ? ` ${extra.join(" ")}` : "";
    return addToken({
      html: `<${normalizedTag}${attrStr}>`,
      tag: normalizedTag,
      closing: false,
      selfClosing: false,
      isBlock,
    });
  });

  return { text: working, tokens };
}

function renderInline(raw: string, tokens: HtmlToken[]): string {
  const escaped = escapeHtml(raw)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) =>
      safeLink(label, href.replace(/&amp;/g, "&"))
    );
  return escaped.replace(/\u0000T(\d+)\u0000/g, (_, idx: string) => tokens[Number(idx)]?.html ?? "");
}

export function renderMarkdown(source: string): string {
  const { text: tokenized, tokens } = tokenizeSafeHtml(source);
  const lines = tokenized.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];
  let htmlBlockDepth = 0;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(`<p>${paragraph.map((line) => renderInline(line, tokens)).join("<br/>")}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(`<ul>${list.map((item) => `<li>${renderInline(item, tokens)}</li>`).join("")}</ul>`);
      list = [];
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      blocks.push(`<blockquote><p>${quote.map((line) => renderInline(line, tokens)).join("<br/>")}</p></blockquote>`);
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
    const trimmed = line.trim();

    // Periksa token HTML pada baris ini.
    const lineTokenIds = Array.from(trimmed.matchAll(/\u0000T(\d+)\u0000/g), (m) => Number(m[1]));
    const lineTokens = lineTokenIds.map((id) => tokens[id]!).filter(Boolean);
    const hasBlockToken = lineTokens.some((t) => t.isBlock);
    const isStandaloneImg =
      lineTokens.length === 1 &&
      lineTokens[0]!.tag === "img" &&
      trimmed.replace(/\u0000T\d+\u0000/g, "").trim() === "";

    let depthDelta = 0;
    for (const t of lineTokens) {
      if (t.isBlock && !t.selfClosing) {
        depthDelta += t.closing ? -1 : 1;
      }
    }

    if (htmlBlockDepth > 0 || hasBlockToken || isStandaloneImg) {
      flushAll();
      if (trimmed) {
        blocks.push(renderInline(trimmed, tokens));
      }
      htmlBlockDepth = Math.max(0, htmlBlockDepth + depthDelta);
      continue;
    }

    const youtube = YOUTUBE_LINE.exec(trimmed);
    if (youtube) {
      flushAll();
      blocks.push(youTubeEmbed(youtube[1]!));
      continue;
    }
    if (!trimmed) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const tag = `h${heading[1]!.length + 1}`;
      blocks.push(`<${tag}>${renderInline(heading[2]!, tokens)}</${tag}>`);
      continue;
    }
    const listItem = /^[-*]\s+(.*)$/.exec(trimmed);
    if (listItem) {
      flushParagraph();
      flushQuote();
      list.push(listItem[1]!);
      continue;
    }
    const quoteLine = /^>\s?(.*)$/.exec(trimmed);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]!);
      continue;
    }
    if (trimmed === "---") {
      flushAll();
      blocks.push("<hr/>");
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }
  flushAll();
  return blocks.join("\n");
}

/** Ubah konten HTML/Markdown menjadi ringkasan teks polos untuk daftar kandidat. */
export function markdownToPlain(source: string, maxLength = 160): string {
  const plain = source
    .replace(/<(?:iframe|script|style)\b[^>]*>[\s\S]*?<\/(?:iframe|script|style)>/gi, " ")
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|figure|figcaption)>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/)|youtu\.be\/)[A-Za-z0-9_-]+\S*/g, "")
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
