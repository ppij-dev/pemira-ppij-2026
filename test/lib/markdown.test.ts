import { describe, expect, it } from "vitest";
import { markdownToPlain, renderMarkdown } from "../../src/server/lib/markdown";

describe("renderMarkdown", () => {
  it("never lets raw html through", () => {
    const html = renderMarkdown('<script>alert(1)</script> dan <img src=x onerror=alert(1)>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders headings, bold, italic, lists, quotes and rules", () => {
    const html = renderMarkdown("## Visi\n\n**Keras** dan *tegas* serta `kode`\n\n- Satu\n- Dua\n\n> Kutipan\n\n---");
    expect(html).toContain("<h3>Visi</h3>");
    expect(html).toContain("<strong>Keras</strong>");
    expect(html).toContain("<em>tegas</em>");
    expect(html).toContain("<code>kode</code>");
    expect(html).toContain("<ul><li>Satu</li><li>Dua</li></ul>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr/>");
  });

  it("renders youtube watch urls on their own line as a click-to-load facade", () => {
    const html = renderMarkdown("Perkenalan:\n\nhttps://www.youtube.com/watch?v=wDchsz8nmbo\n\nSelesai.");
    expect(html).toContain('data-video-id="wDchsz8nmbo"');
    expect(html).toContain('src="https://i.ytimg.com/vi/wDchsz8nmbo/hqdefault.jpg"');
    expect(html).toContain("markdown-video-facade");
    expect(html).toContain('href="https://www.youtube.com/watch?v=wDchsz8nmbo"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("<iframe");
  });

  it("facades youtu.be and shorts urls", () => {
    expect(renderMarkdown("https://youtu.be/wDchsz8nmbo")).toContain('data-video-id="wDchsz8nmbo"');
    expect(renderMarkdown("https://www.youtube.com/shorts/wDchsz8nmbo")).toContain('data-video-id="wDchsz8nmbo"');
  });

  it("keeps safe links and neutralizes unsafe ones", () => {
    const safe = renderMarkdown("[Portal](https://ppijepang.app)");
    expect(safe).toContain('<a href="https://ppijepang.app"');
    const unsafe = renderMarkdown("[Klik](javascript:alert(1))");
    expect(unsafe).not.toContain("<a ");
    const relative = renderMarkdown("[Daftar](/kandidat)");
    expect(relative).toContain('<a href="/kandidat"');
  });

  it("renders plain paragraphs with line breaks", () => {
    const html = renderMarkdown("Baris satu\nBaris dua");
    expect(html).toBe("<p>Baris satu<br/>Baris dua</p>");
  });
});

describe("markdownToPlain", () => {
  it("strips syntax and youtube urls for listing snippets", () => {
    const plain = markdownToPlain("## Visi\n\n**Keras** dan *tegas*\n\nhttps://www.youtube.com/watch?v=wDchsz8nmbo");
    expect(plain).toBe("Visi Keras dan tegas");
  });

  it("truncates long content with an ellipsis", () => {
    const plain = markdownToPlain("a".repeat(200), 50);
    expect(plain.length).toBe(50);
    expect(plain.endsWith("…")).toBe(true);
  });
});
