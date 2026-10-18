import { Hono } from "hono";
import type { Bindings } from "../app";
import { setupGuard } from "./guard";

/**
 * Sub-aplikasi /api/setup/*: satu-satunya jalur /api yang hidup selama situs
 * belum terinisialisasi, dijaga setupGuard (klaim peramban, jendela 60 menit,
 * 404 selamanya setelah selesai). Endpoint langkah wizard ditambahkan oleh
 * tugas 2.2 dan 2.3 pada berkas ini.
 */
const setupRoutes = new Hono<{ Bindings: Bindings }>();

setupRoutes.use("*", setupGuard());

export { setupRoutes };
