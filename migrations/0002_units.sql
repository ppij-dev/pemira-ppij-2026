CREATE TABLE units (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_path TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('national','korda','komsat'))
);
