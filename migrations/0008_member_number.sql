ALTER TABLE voters ADD COLUMN member_number TEXT;
CREATE INDEX idx_voters_member_number ON voters(member_number);
