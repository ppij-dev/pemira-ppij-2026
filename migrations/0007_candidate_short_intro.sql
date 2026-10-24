ALTER TABLE candidates ADD COLUMN short_intro TEXT NOT NULL DEFAULT '' CHECK (length(short_intro) <= 100);
