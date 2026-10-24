export const DEFAULT_LOGO_PATH = "/ppij-logo.png";
const LEGACY_DEFAULT_LOGO_PATH = "/logo.svg";

export const ALLOWED_LOGO_EXTENSIONS = [
  ".svg",
  ".png",
  ".webp",
  ".jpg",
  ".jpeg",
] as const;

export type AllowedLogoExtension = (typeof ALLOWED_LOGO_EXTENSIONS)[number];

export const FAVICON_MIME_TYPES: Record<AllowedLogoExtension, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/**
 * Validates whether a candidate path is a safe, same-origin absolute path:
 * - string, non-empty
 * - starts with single '/' and NOT '//'
 * - no scheme (no ':')
 * - no whitespace
 * - no backslashes
 * - ends with an allowed extension (.svg, .png, .webp, .jpg, .jpeg)
 */
export function isValidLogoPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0) {
    return false;
  }
  if (!path.startsWith("/") || path.includes("//")) {
    return false;
  }
  if (/\s/.test(path)) {
    return false;
  }
  if (path.includes("\\")) {
    return false;
  }
  if (path.includes(":") || path.includes("?") || path.includes("#")) {
    return false;
  }
  if (path.includes('"') || path.includes("'") || path.includes("<") || path.includes(">")) {
    return false;
  }
  const match = path.match(/\.([a-zA-Z0-9]+)$/);
  if (!match) {
    return false;
  }
  const ext = `.${match[1].toLowerCase()}` as AllowedLogoExtension;
  return (ALLOWED_LOGO_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Returns the validated same-origin logo path. The old bundled placeholder path
 * resolves to the PPIJ logo for already bootstrapped instances.
 */
export function resolveSiteLogoPath(path: unknown): string {
  if (path === LEGACY_DEFAULT_LOGO_PATH) return DEFAULT_LOGO_PATH;
  return isValidLogoPath(path) ? path : DEFAULT_LOGO_PATH;
}

/**
 * Derives the favicon MIME type from a logo path's extension.
 * Defaults to "image/svg+xml" if extension is unknown or missing.
 */
export function getFaviconType(path: string): string {
  const cleanPath = path.split(/[?#]/)[0];
  const match = cleanPath.match(/\.([a-zA-Z0-9]+)$/);
  if (!match) {
    return "image/svg+xml";
  }
  const ext = `.${match[1].toLowerCase()}` as AllowedLogoExtension;
  return FAVICON_MIME_TYPES[ext] ?? "image/svg+xml";
}

export interface SiteLogo {
  src: string;
  faviconType: string;
}

/**
 * Resolves a safe logo path and corresponding favicon MIME type.
 */
export function getSiteLogo(path: unknown): SiteLogo {
  const src = resolveSiteLogoPath(path);
  return {
    src,
    faviconType: getFaviconType(src),
  };
}
