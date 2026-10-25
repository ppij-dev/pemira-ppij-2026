import { describe, expect, it } from "vitest";
import { markdownToPlain, renderMarkdown } from "../../src/server/lib/markdown";

describe("renderMarkdown", () => {
  it("never lets dangerous html or event handlers through", () => {
    const html = renderMarkdown('<script>alert(1)</script> dan <img src=x onerror=alert(1)> dan <iframe src="javascript:alert(1)"></iframe>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders headings, bold, italic, lists, quotes and rules from markdown", () => {
    const html = renderMarkdown("## Visi\n\n**Keras** dan *tegas* serta `kode`\n\n- Satu\n- Dua\n\n> Kutipan\n\n---");
    expect(html).toContain("<h3>Visi</h3>");
    expect(html).toContain("<strong>Keras</strong>");
    expect(html).toContain("<em>tegas</em>");
    expect(html).toContain("<code>kode</code>");
    expect(html).toContain("<ul><li>Satu</li><li>Dua</li></ul>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr/>");
  });

  it("renders html article tags, images, and slideshare/youtube embeds without breaking playback via sandbox", () => {
    const slideShareSnippet =
      '<h2>Materi Presentasi</h2>\n' +
      '<p>Ringkasan <strong>program kerja</strong> dan <em>agenda</em>.</p>\n' +
      '<img src="/candidates/sample_image.jpg" alt="Dokumentasi kegiatan" width="1080" height="810" />\n' +
      '<iframe src="https://www.slideshare.net/slideshow/embed_code/key/BDRrNEaAYr9L5D" width="510" height="420"frameborder="0" marginwidth="0" marginheight="0" scrolling="no"style="border: var(--border-1) solid #CCC; border-width:1px; margin-bottom:5px; max-width:100%;"allowfullscreen></iframe><div style="margin-bottom:5px"><strong><a href="https://www.slideshare.net/slideshow/dxdevopstechlive/229735702" title="dxdevopstechlive" target="_blank">dxdevopstechlive</a></strong>from <strong><a href="https://www.slideshare.net/TokorotenNakayama" target="_blank">Tokoroten Nakayama</a></strong></div>';
    const html = renderMarkdown(slideShareSnippet);
    expect(html).toContain("<h2>Materi Presentasi</h2>");
    expect(html).toContain("<p>Ringkasan <strong>program kerja</strong> dan <em>agenda</em>.</p>");
    expect(html).toContain('<img src="/candidates/sample_image.jpg" alt="Dokumentasi kegiatan" width="1080" height="810" loading="lazy" />');
    expect(html).toContain('src="https://www.slideshare.net/slideshow/embed_code/key/BDRrNEaAYr9L5D"');
    expect(html).toContain('width="510"');
    expect(html).toContain('height="420"');
    expect(html).not.toContain("sandbox=");
    expect(html).toContain('<a href="https://www.slideshare.net/slideshow/dxdevopstechlive/229735702" title="dxdevopstechlive" target="_blank" rel="noopener noreferrer">dxdevopstechlive</a>');
  });

  it("renders youtube watch urls on their own line as a playable embed without sandbox", () => {
    const html = renderMarkdown("Perkenalan:\n\nhttps://www.youtube.com/watch?v=wDchsz8nmbo\n\nSelesai.");
    expect(html).toContain('src="https://www.youtube.com/embed/wDchsz8nmbo"');
    expect(html).toContain('allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"');
    expect(html).toContain('href="https://www.youtube.com/watch?v=wDchsz8nmbo"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("sandbox=");
  });

  it("embeds youtu.be, shorts urls, and html youtube iframes", () => {
    expect(renderMarkdown("https://youtu.be/wDchsz8nmbo")).toContain('src="https://www.youtube.com/embed/wDchsz8nmbo"');
    expect(renderMarkdown("https://www.youtube.com/shorts/wDchsz8nmbo")).toContain('src="https://www.youtube.com/embed/wDchsz8nmbo"');
    const iframeHtml = renderMarkdown('<iframe src="https://www.youtube.com/embed/wDchsz8nmbo" allowfullscreen></iframe>');
    expect(iframeHtml).toContain('src="https://www.youtube.com/embed/wDchsz8nmbo"');
    expect(iframeHtml).not.toContain("sandbox=");
  });

  it("keeps safe links and neutralizes unsafe ones in both markdown and html", () => {
    const safe = renderMarkdown("[Portal](https://ppijepang.app)");
    expect(safe).toContain('<a href="https://ppijepang.app"');
    const unsafe = renderMarkdown("[Klik](javascript:alert(1)) dan <a href=\"javascript:alert(2)\">Tautan</a>");
    expect(unsafe).not.toContain("<a ");
    expect(unsafe).toContain("Tautan");
    const relative = renderMarkdown("[Daftar](/kandidat)");
    expect(relative).toContain('<a href="/kandidat"');
  });

  it("renders plain paragraphs with line breaks", () => {
    const html = renderMarkdown("Baris satu\nBaris dua");
    expect(html).toBe("<p>Baris satu<br/>Baris dua</p>");
  });
});

describe("markdownToPlain", () => {
  it("strips html tags, markdown syntax, and youtube urls for listing snippets", () => {
    const plain = markdownToPlain('<h2>Visi</h2>\n\n<p><strong>Keras</strong> dan <em>tegas</em></p>\n\n<iframe src="https://www.slideshare.net/slideshow/embed_code/key/BDRrNEaAYr9L5D"></iframe>\n\nhttps://www.youtube.com/watch?v=wDchsz8nmbo');
    expect(plain).toBe("Visi Keras dan tegas");
  });

  it("truncates long content with an ellipsis", () => {
    const plain = markdownToPlain("a".repeat(200), 50);
    expect(plain.length).toBe(50);
    expect(plain.endsWith("…")).toBe(true);
  });
});
