ALTER TABLE elections ADD COLUMN preview_mode INTEGER NOT NULL DEFAULT 0 CHECK (preview_mode IN (0, 1));
