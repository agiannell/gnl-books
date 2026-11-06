-- Everyone who reads, kids included.
create table if not exists profiles (
  id uuid primary key,
  family_id uuid not null references families (id) on delete cascade,
  name text not null,
  emoji text,
  color text,
  is_parent boolean not null default false,
  alexa_person_id text unique,
  created_at timestamptz not null default now()
)
