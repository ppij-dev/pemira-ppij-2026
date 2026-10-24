import type { MiddlewareHandler } from "hono";

/**
 * Header X-Robots-Tag di setiap respons: situs ini tidak untuk mesin pencari,
 * sejalan dengan /robots.txt yang melarang semua perayapan. Dipasang paling
 * awal di src/fetch.ts sehingga berlaku untuk /api dan semua halaman.
 */
export const noindex: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } finally {
    c.header("X-Robots-Tag", "noindex, nofollow");
  }
};
