create table if not exists families (
  id uuid primary key,
  name text not null,
  parent_pin_hash text not null,
  created_at timestamptz not null default now()
)
