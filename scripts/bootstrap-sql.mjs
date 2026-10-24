export function escapeSqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildBootstrapStatements({
  memberId,
  siteName,
  siteScope,
  siteBaseUrl,
  siteLogoPath = "/pemira-2026-logo.png",
  now = new Date().toISOString(),
}) {
  const qTitle = escapeSqlString(siteName);
  const qMember = escapeSqlString(memberId);
  const qNow = escapeSqlString(now);
  const qScope = escapeSqlString(siteScope);
  const qBaseUrl = escapeSqlString(siteBaseUrl);
  const qLogo = escapeSqlString(siteLogoPath);

  return [
    `INSERT INTO elections (title, status_lock) SELECT ${qTitle}, 'draft' WHERE NOT EXISTS (SELECT 1 FROM elections)`,
    `INSERT INTO admin_voting (member_id, name, is_technical, created_at) VALUES (${qMember}, 'Technical Admin', 1, ${qNow})`,
    `INSERT INTO system_config (key, value) VALUES ('site_scope', ${qScope}), ('site_base_url', ${qBaseUrl}), ('site_name', ${qTitle}), ('site_logo_path', ${qLogo}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    `INSERT INTO system_config (key, value) VALUES ('initialized', '1') ON CONFLICT(key) DO UPDATE SET value='1'`,
  ];
}
