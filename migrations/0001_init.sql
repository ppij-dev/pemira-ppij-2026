CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE admin_voting (
  member_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_technical INTEGER NOT NULL DEFAULT 0 CHECK (is_technical IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE invitations (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX idx_invitations_member_id ON invitations(member_id);

CREATE TABLE elections (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status_lock TEXT NOT NULL DEFAULT 'draft'
    CHECK (status_lock IN ('draft', 'locked', 'published')),
  opens_at TEXT,
  closes_at TEXT,
  closed_early_at TEXT,
  allow_admin_voting INTEGER NOT NULL DEFAULT 1 CHECK (allow_admin_voting IN (0, 1))
);

CREATE TABLE candidates (
  id INTEGER PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE,
  number INTEGER NOT NULL UNIQUE CHECK (number > 0),
  name TEXT NOT NULL,
  nickname TEXT NOT NULL,
  komsat_path TEXT NOT NULL,
  photo_key TEXT,
  youtube_url TEXT,
  content_html TEXT NOT NULL DEFAULT '',
  color TEXT
);
CREATE UNIQUE INDEX idx_candidates_nickname ON candidates(nickname COLLATE NOCASE);

CREATE TABLE voters (
  member_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  komsat_path TEXT NOT NULL,
  status TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_voters_komsat_path ON voters(komsat_path);

CREATE TABLE membership_changes (
  id INTEGER PRIMARY KEY,
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  actor_member_id TEXT,
  actor_name TEXT,
  value_from TEXT,
  value_to TEXT,
  changed_at TEXT NOT NULL
);
CREATE INDEX idx_membership_changes_member_id ON membership_changes(member_id);
CREATE INDEX idx_membership_changes_changed_at ON membership_changes(changed_at);

CREATE TABLE participation (
  election_id INTEGER NOT NULL REFERENCES elections(id),
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  voted_at TEXT NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
  PRIMARY KEY (election_id, member_id)
);

CREATE TABLE ballots (
  id TEXT PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id),
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  komsat_path TEXT NOT NULL,
  receipt_hash TEXT NOT NULL UNIQUE,
  is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1))
) WITHOUT ROWID;
CREATE INDEX idx_ballots_election_komsat ON ballots(election_id, komsat_path);
CREATE INDEX idx_ballots_election_candidate ON ballots(election_id, candidate_id);

CREATE TABLE reminders (
  member_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  sent_at TEXT NOT NULL,
  PRIMARY KEY (member_id, channel, sent_at)
);

CREATE TABLE audit_log (
  seq INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'voter', 'system')),
  actor_member_id TEXT,
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT,
  komsat_path TEXT,
  detail_json TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
