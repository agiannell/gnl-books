-- Append-only log of every "I read 30 pages", from web, voice or widget.
-- NO ACTION, not CASCADE: the log is unbounded and DSQL caps a transaction at
-- 3,000 rows, so entries are deleted in batches from app code.
create table if not exists progress_events (
  id uuid primary key,
  shelf_entry_id uuid not null references shelf_entries (id),
  at timestamptz not null default now(),
  page int,
  pages_read int,
  source text not null check (source in ('web', 'alexa', 'widget'))
)
