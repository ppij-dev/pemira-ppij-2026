const quote = (value) => `'${value.replaceAll("'", "''")}'`;

export function recoveryInvitationSql({ memberId, tokenHash, createdAt, expiresAt, previousHash, auditHash }) {
  return `INSERT INTO invitations (token_hash, member_id, created_at, expires_at) VALUES (${quote(tokenHash)}, ${quote(memberId)}, ${quote(createdAt)}, ${quote(expiresAt)}); INSERT INTO audit_log (at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash) VALUES (${quote(createdAt)},'system',NULL,'Cloudflare operator','admin_invitation_recovery',${quote(memberId)},NULL,NULL,${quote(previousHash)},${quote(auditHash)});`;
}
