-- Wrong parent-PIN guesses since the last success or lockout. Nullable, and
-- null means zero: DSQL rejects NOT NULL and DEFAULT on ADD COLUMN.
alter table families add column if not exists failed_pin_attempts integer
