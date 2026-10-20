import { pathToFileURL } from "node:url";

const quote = (value) => `'${value.replaceAll("'", "''")}'`;

export function recoveryInvitationSql({ memberId, tokenHash, createdAt, expiresAt, previousHash, auditHash }) {
  return [
    `INSERT INTO invitations (token_hash, member_id, created_at, expires_at) VALUES (${quote(tokenHash)}, ${quote(memberId)}, ${quote(createdAt)}, ${quote(expiresAt)})`,
    `INSERT INTO audit_log (at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash) VALUES (${quote(createdAt)},'system',NULL,'Cloudflare operator','admin_invitation_recovery',${quote(memberId)},NULL,NULL,${quote(previousHash)},${quote(auditHash)})`,
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const memberId = args.find((arg) => !arg.startsWith("--"))?.trim();
  if (!memberId) {
    console.error("Gunakan: npm run recovery-invite -- <member_id>");
    process.exitCode = 1;
    return;
  }
  if (args.includes("--remote")) throw new Error("Pemulihan jarak jauh tidak didukung oleh perintah ini.");
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy({ remoteBindings: false });
  try {
    const db = proxy.env.DB;
    const query = async (statement) => (await db.prepare(statement).all()).results;
    const voter = (await db.prepare(`SELECT v.member_id, v.name, v.status, v.komsat_path, s.value AS scope FROM voters v CROSS JOIN system_config s WHERE v.member_id=${quote(memberId)} AND s.key='site_scope'`).all()).results[0];
    const scope = voter?.scope?.replace(/\/+$/, "");
    if (!voter || voter.status.toUpperCase() !== "ACTIVE" || !(voter.komsat_path === scope || voter.komsat_path.startsWith(`${scope}/`))) throw new Error("Anggota harus tercatat ACTIVE dalam cakupan situs.");
    if ((await query(`SELECT member_id FROM candidates WHERE member_id=${quote(memberId)}`)).length) throw new Error("Kandidat tidak dapat menjadi Admin Voting.");
    if ((await query(`SELECT member_id FROM admin_voting WHERE member_id=${quote(memberId)}`)).length) throw new Error("Anggota sudah menjadi Admin Voting.");
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((value) => value.toString(16).padStart(2, "0")).join("");
    const at = new Date().toISOString();
    const expires = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const previousHash = (await query("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1"))[0]?.hash ?? "0".repeat(64);
    const entry = { at, actor_type:"system", actor_member_id:null, actor_name:"Cloudflare operator", action:"admin_invitation_recovery", target:memberId, komsat_path:null, detail_json:null, prev_hash:previousHash };
    const auditHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(previousHash + JSON.stringify(entry))))].map((value) => value.toString(16).padStart(2, "0")).join("");
    const baseUrl = (await query("SELECT value FROM system_config WHERE key='site_base_url'"))[0]?.value;
    if (!baseUrl) throw new Error("SITE_BASE_URL tidak ditemukan pada konfigurasi situs.");
    const statements = recoveryInvitationSql({ memberId, tokenHash: hash, createdAt: at, expiresAt: expires, previousHash, auditHash });
    await db.batch(statements.map((statement) => db.prepare(statement)));
    console.log(`${baseUrl}/api/admin/invitations/${encodeURIComponent(token)}/accept`);
  } finally {
    await proxy.dispose();
  }
}

if (typeof process !== "undefined" && process.argv?.[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
