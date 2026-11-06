-- `shelf` uses the exact Goodreads `Exclusive Shelf` vocabulary so CSV export is a pass-through.
-- `tags` is a JSON array of strings: DSQL has no array column types.
-- The profile and book references are NO ACTION, not CASCADE: DSQL caps a
-- transaction at 3,000 rows and a profile's entries are unbounded, so deleting
-- a profile is a batched delete in app code.
create table if not exists shelf_entries (
  id uuid primary key,
  profile_id uuid not null references profiles (id),
  book_id uuid not null references books (id),
  shelf text not null check (shelf in ('to-read', 'currently-reading', 'read')),
  rating smallint check (rating between 1 and 5),
  review text,
  private_notes text,
  date_added date not null default current_date,
  date_started date,
  date_read date,
  read_count int not null default 1,
  current_page int,
  owned boolean not null default false,
  tags jsonb not null default '[]',
  updated_at timestamptz not null default now()
)
