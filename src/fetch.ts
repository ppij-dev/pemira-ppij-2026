import { cf } from "@astrojs/cloudflare/hono";
import { Hono } from "hono";
import { getRuntimeKey } from "hono/adapter";
import { actions, i18n, middleware, pages, sessions } from "astro/hono";
import { app as api, type Bindings } from "./server/app";

const app = new Hono<{ Bindings: Bindings }>();

// Cloudflare setup first so bindings and locals exist for everything below.
// cf() needs a Cloudflare ExecutionContext, which `astro dev` (Node) does not
// provide; there the adapter's dev handler covers Cloudflare-specific setup.
if (getRuntimeKey() === "workerd") {
  app.use(cf());
}

// Hono API: /api/*
app.route("/", api);

// Astro pipeline: actions, user middleware, sessions, i18n, then page rendering.
app.use(actions());
app.use(middleware());
app.use(sessions());
app.use(i18n());
app.use(pages());

export default app;
