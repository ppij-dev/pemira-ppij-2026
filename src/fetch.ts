import { cf } from "@astrojs/cloudflare/hono";
import { Hono } from "hono";
import { getRuntimeKey } from "hono/adapter";
import { actions, i18n, middleware, pages, sessions } from "astro/hono";
import { app as api, type Bindings } from "./server/app";
import { setupGuard } from "./server/setup/guard";
import { noindex } from "./server/middleware/noindex";

const app = new Hono<{ Bindings: Bindings }>();

// Mesin pencari tidak boleh mengindeks situs ini: header di semua respons
// (halaman dan /api), dilengkapi /robots.txt dan meta robots di layout dasar.
app.use("*", noindex);

// Cloudflare setup first so bindings and locals exist for everything below.
// cf() needs a Cloudflare ExecutionContext, which `astro dev` (Node) does not
// provide; there the adapter's dev handler covers Cloudflare-specific setup.
if (getRuntimeKey() === "workerd") {
  app.use(cf());
}
// Block reserved setup URLs and fail closed until operator bootstrap completes.
app.use("*", setupGuard());

// Hono API: /api/*
app.route("/", api);

app.use(actions());
app.use(middleware());
app.use(sessions());
app.use(i18n());
app.use(pages());

export default app;
