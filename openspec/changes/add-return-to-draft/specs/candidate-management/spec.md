# Spec Delta: Candidate protection while kept ballots reference them

## Purpose

While kept ballots point at a candidate, that candidate cannot be deleted and cannot have
its member replaced — the ballots were cast for that person — while every other edit
stays open.

## ADDED Requirements

### Requirement: Candidates referenced by kept ballots are protected

While kept (non-test) ballots reference a candidate, candidate management SHALL refuse to
delete that candidate and SHALL refuse to replace its underlying member (a new member
reference in the candidate form), each with a message naming the kept ballots. All other
edits — name, nickname, description, intro, nomor urut under the existing rules — SHALL
remain allowed, and candidates without kept ballots SHALL behave exactly as today.

#### Scenario: Deleting a candidate with ballots refused

- **WHEN** an Admin Voting deletes a candidate that kept ballots point at
- **THEN** the request is refused with a message naming the kept ballots and the
  candidate stays registered

#### Scenario: Replacing a candidate's member refused

- **WHEN** an Admin Voting saves a candidate that kept ballots point at with a different
  member reference
- **THEN** the request is refused with a message naming the kept ballots and the
  candidate keeps its member

#### Scenario: Other edits allowed

- **WHEN** an Admin Voting renames a candidate that kept ballots point at, or edits its
  nickname, description or intro
- **THEN** the edit is saved as in any Draf election

#### Scenario: Candidates without ballots unchanged

- **WHEN** an Admin Voting deletes a candidate that no kept ballot references
- **THEN** the deletion succeeds as today
