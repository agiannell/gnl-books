-- A signed-in user with no family asking to join one. A parent approves it (which
-- makes an `accounts` row) or denies it (which deletes it). At most one per user,
-- and only the newest 7 days of them count; both are enforced in the app.
create table if not exists join_requests (
  id uuid primary key,
  cognito_sub text not null,
  email text not null,
  family_id uuid not null references families (id) on delete cascade,
  created_at timestamptz not null default now()
)
