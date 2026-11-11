-- When a parent turned the request down. A denied request is kept (for the usual 7 days, counted
-- from the denial) so the person who asked can be told, instead of waiting for ever. Null means
-- still open. Nullable, because DSQL rejects NOT NULL on ADD COLUMN.
alter table join_requests add column if not exists denied_at timestamptz
