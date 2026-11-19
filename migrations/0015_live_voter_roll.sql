-- Saklar "Tidak Membekukan DPT": hanya dapat diubah saat Draf, dan nilainya
-- dibekukan saat Kunci & Jadwalkan (pola yang sama dengan
-- single_candidate_mode). Saat saklar menyala, roll tidak dibekukan dan
-- mengikuti portal selama pemungutan suara (pemilihan langsung).
ALTER TABLE elections ADD COLUMN live_voter_roll INTEGER NOT NULL DEFAULT 0 CHECK (live_voter_roll IN (0, 1));
