-- The account's verified sign-in email, lower-cased. It is how a new user names a
-- family to ask to join ("the email of a parent"). Nullable, because the first
-- accounts predate it and DSQL rejects NOT NULL on ADD COLUMN.
alter table accounts add column if not exists email text
