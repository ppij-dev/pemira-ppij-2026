## ADDED Requirements

### Requirement: Published results show every korda as Setuju versus Tidak Setuju
Once results are Diumumkan in single candidate mode, the public results SHALL show every korda's
Setuju and Tidak Setuju counts without a minimum-ballot threshold, SHALL NOT show Abstain, and SHALL
compute Setuju and Tidak Setuju as shares of suara masuk (summing to 100%) while Partisipasi is
suara masuk divided by Hak pilih.

#### Scenario: Korda with few ballots
- **WHEN** a korda has 6 ballots after Diumumkan
- **THEN** its Setuju and Tidak Setuju counts and percentages are shown, not "Data terlalu sedikit"

#### Scenario: Korda with no ballots
- **WHEN** a korda has 0 ballots
- **THEN** Partisipasi shows 0% and the vote bar shows "Belum ada suara masuk"

#### Scenario: Beranda after Diumumkan
- **WHEN** a visitor opens the beranda after Diumumkan
- **THEN** the Hasil card shows the final Setuju and Tidak Setuju result and links to `/hasil`
