ALTER TABLE elections ADD COLUMN frozen_hak_pilih INTEGER;
ALTER TABLE elections ADD COLUMN frozen_at TEXT;
ALTER TABLE candidates ADD COLUMN description TEXT NOT NULL DEFAULT '';
