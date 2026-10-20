import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { actions, i18n, middleware, pages, sessions } from "astro/hono";
import { app as api, type Bindings } from "./server/app";
import { setupGuard } from "./server/setup/guard";
import { noindex } from "./server/middleware/noindex";

const app = new Hono<{ Bindings: Bindings }>();

// Mesin pencari tidak boleh mengindeks situs ini: header di semua respons
// (halaman dan /api), dilengkapi /robots.txt dan meta robots di layout dasar.
app.use("*", noindex);

// Block reserved setup URLs and fail closed until operator bootstrap completes.
app.use("*", setupGuard());

// Hono API: /api/*
app.route("/", api);

app.use(actions());
app.use(middleware());
app.use(sessions());
app.use(i18n());
app.use(pages());

// Astro's adapter owns the ExecutionContext and supplies render state on request.
export default {
  fetch: (request: Request) => app.fetch(request, env as unknown as Bindings),
};
