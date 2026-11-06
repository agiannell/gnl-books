-- Cognito users (the adults). Kids never get accounts.
create table if not exists accounts (
  cognito_sub text primary key,
  family_id uuid not null references families (id) on delete cascade,
  created_at timestamptz not null default now()
)
