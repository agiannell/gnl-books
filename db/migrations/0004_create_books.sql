-- Shared metadata cache, one row per book across the whole family.
-- `authors` is a JSON array of names in order: DSQL has no array column types.
create table if not exists books (
  id uuid primary key,
  source text not null,
  source_id text,
  title text not null,
  subtitle text,
  authors jsonb not null default '[]',
  isbn13 text,
  isbn10 text,
  pages int,
  publisher text,
  binding text,
  release_year int,
  original_pub_year int,
  cover_url text,
  series_name text,
  series_position numeric,
  description text,
  cached_at timestamptz not null default now()
)
