import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOGO_PATH,
  getFaviconType,
  getSiteLogo,
  isValidLogoPath,
  resolveSiteLogoPath,
} from "../../src/server/lib/logo";

describe("isValidLogoPath", () => {
  it("menerima path logo lokal yang valid", () => {
    expect(isValidLogoPath("/logo.svg")).toBe(true);
    expect(isValidLogoPath("/ppi-okayama-logo.webp")).toBe(true);
    expect(isValidLogoPath("/images/logo.png")).toBe(true);
    expect(isValidLogoPath("/assets/brand.jpg")).toBe(true);
    expect(isValidLogoPath("/assets/brand.jpeg")).toBe(true);
    expect(isValidLogoPath("/LOGO.SVG")).toBe(true);
  });

  it("menolak url dengan skema atau domain eksternal", () => {
    expect(isValidLogoPath("//evil.com/x.png")).toBe(false);
    expect(isValidLogoPath("https://x/y.png")).toBe(false);
    expect(isValidLogoPath("http://x/y.png")).toBe(false);
    expect(isValidLogoPath("javascript:")).toBe(false);
    expect(isValidLogoPath("data:image/svg+xml;base64,...")).toBe(false);
  });

  it("menolak path dengan spasi atau karakter tidak aman", () => {
    expect(isValidLogoPath("/a b.png")).toBe(false);
    expect(isValidLogoPath("/logo .svg")).toBe(false);
    expect(isValidLogoPath("/\\evil.com/x.png")).toBe(false);
    expect(isValidLogoPath("/http://evil.com/x.png")).toBe(false);
    expect(isValidLogoPath("/a.png?x=.svg")).toBe(false);
    expect(isValidLogoPath("/a.png#x")).toBe(false);
    expect(isValidLogoPath('/x.png?a="onerror=alert(1)//.png')).toBe(false);
    expect(isValidLogoPath("/..//x.png")).toBe(false);
  });

  it("menolak ekstensi yang tidak diizinkan atau tanpa ekstensi", () => {
    expect(isValidLogoPath("/x.exe")).toBe(false);
    expect(isValidLogoPath("/x.html")).toBe(false);
    expect(isValidLogoPath("/logo.svg.bak")).toBe(false);
    expect(isValidLogoPath("/logo")).toBe(false);
    expect(isValidLogoPath("/")).toBe(false);
  });

  it("menolak nilai kosong atau bukan string", () => {
    expect(isValidLogoPath("")).toBe(false);
    expect(isValidLogoPath("   ")).toBe(false);
    expect(isValidLogoPath(null)).toBe(false);
    expect(isValidLogoPath(undefined)).toBe(false);
    expect(isValidLogoPath(123)).toBe(false);
    expect(isValidLogoPath({})).toBe(false);
  });
});

describe("resolveSiteLogoPath", () => {
  it("mengembalikan path jika valid dan fallback /logo.svg jika tidak valid", () => {
    expect(resolveSiteLogoPath("/ppi-okayama-logo.webp")).toBe("/ppi-okayama-logo.webp");
    expect(resolveSiteLogoPath("/logo.svg")).toBe("/logo.svg");
    expect(resolveSiteLogoPath("//evil.com/x.png")).toBe(DEFAULT_LOGO_PATH);
    expect(resolveSiteLogoPath("https://x/y.png")).toBe(DEFAULT_LOGO_PATH);
    expect(resolveSiteLogoPath("javascript:")).toBe(DEFAULT_LOGO_PATH);
    expect(resolveSiteLogoPath("/a b.png")).toBe(DEFAULT_LOGO_PATH);
    expect(resolveSiteLogoPath("/x.exe")).toBe(DEFAULT_LOGO_PATH);
    expect(resolveSiteLogoPath("")).toBe(DEFAULT_LOGO_PATH);
    expect(resolveSiteLogoPath(null)).toBe(DEFAULT_LOGO_PATH);
    expect(resolveSiteLogoPath(undefined)).toBe(DEFAULT_LOGO_PATH);
  });
});

describe("getFaviconType", () => {
  it("memetakan ekstensi logo ke MIME type favicon yang sesuai", () => {
    expect(getFaviconType("/logo.svg")).toBe("image/svg+xml");
    expect(getFaviconType("/ppi-okayama-logo.webp")).toBe("image/webp");
    expect(getFaviconType("/icon.png")).toBe("image/png");
    expect(getFaviconType("/LOGO.PNG")).toBe("image/png");
    expect(getFaviconType("/icon.jpg")).toBe("image/jpeg");
    expect(getFaviconType("/icon.jpeg")).toBe("image/jpeg");
    expect(getFaviconType("/ICON.PNG")).toBe("image/png");
  });

  it("memberikan fallback image/svg+xml untuk path tanpa ekstensi atau tidak dikenal", () => {
    expect(getFaviconType("/logo")).toBe("image/svg+xml");
    expect(getFaviconType("/logo.unknown")).toBe("image/svg+xml");
  });
});

describe("getSiteLogo", () => {
  it("mengembalikan objek src dan faviconType tervalidasi", () => {
    expect(getSiteLogo("/ppi-okayama-logo.webp")).toEqual({
      src: "/ppi-okayama-logo.webp",
      faviconType: "image/webp",
    });
    expect(getSiteLogo("/logo.svg")).toEqual({
      src: "/logo.svg",
      faviconType: "image/svg+xml",
    });
    expect(getSiteLogo("//evil.com/x.png")).toEqual({
      src: "/logo.svg",
      faviconType: "image/svg+xml",
    });
    expect(getSiteLogo(undefined)).toEqual({
      src: "/logo.svg",
      faviconType: "image/svg+xml",
    });
  });
});
