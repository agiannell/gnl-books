-- IANA zone name ("America/Chicago") the family's calendar dates are kept in.
-- Nullable, and null means the app's default zone: DSQL rejects NOT NULL and
-- DEFAULT on ADD COLUMN.
alter table families add column if not exists timezone text
