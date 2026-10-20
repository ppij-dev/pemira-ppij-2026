import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const target = args.includes("--remote") ? "--remote" : "--local";
const memberId = args.find((arg) => !arg.startsWith("--"))?.trim();
if (!memberId) {
  console.error("Gunakan: npm run recover:admin -- <member_id> [--remote]");
  process.exit(1);
}
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const sql = (statement) => {
  const result = spawnSync("npx", ["wrangler", "d1", "execute", "DB", target, "--command", statement, "--json"], { encoding: "utf8", env: process.env });
  if (result.status !== 0) throw new Error("Wrangler D1 command failed");
  const parsed = JSON.parse(result.stdout);
  return parsed[0]?.results ?? [];
};
const voter = sql(`SELECT v.member_id, v.name, v.status, v.komsat_path, s.value AS scope FROM voters v CROSS JOIN system_config s WHERE v.member_id=${quote(memberId)} AND s.key='site_scope'`)[0];
if (!voter || voter.status.toUpperCase() !== "ACTIVE" || !(voter.komsat_path === voter.scope || voter.komsat_path.startsWith(`${voter.scope.replace(/\/+$/, "")}/`))) {
  console.error("Anggota harus tercatat ACTIVE dalam cakupan situs.");
  process.exit(1);
}
if (sql(`SELECT member_id FROM candidates WHERE member_id=${quote(memberId)}`).length) {
  console.error("Kandidat tidak dapat menjadi Admin Voting.");
  process.exit(1);
}
const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((value) => value.toString(16).padStart(2, "0")).join("");
const at = new Date().toISOString();
const expires = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
const previousHash = sql("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1")[0]?.hash ?? "0".repeat(64);
const entry = { at, actor_type:"system", actor_member_id:null, actor_name:"Cloudflare operator", action:"admin_invitation_recovery", target:memberId, komsat_path:null, detail_json:null, prev_hash:previousHash };
const auditHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(previousHash + JSON.stringify(entry))))].map((value) => value.toString(16).padStart(2, "0")).join("");
const link = token;
sql(`BEGIN; INSERT INTO invitations (token_hash, member_id, created_at, expires_at) VALUES (${quote(hash)}, ${quote(memberId)}, ${quote(at)}, ${quote(expires)}); INSERT INTO audit_log (at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash) VALUES (${quote(at)},'system',NULL,'Cloudflare operator','admin_invitation_recovery',${quote(memberId)},NULL,NULL,${quote(previousHash)},${quote(auditHash)}); COMMIT;`);
const baseUrl = sql("SELECT value FROM system_config WHERE key='site_base_url'")[0]?.value;
if (!baseUrl) throw new Error("SITE_BASE_URL tidak ditemukan pada konfigurasi situs.");
console.log(`${baseUrl}/api/admin/invitations/accept?token=${encodeURIComponent(link)}`);
