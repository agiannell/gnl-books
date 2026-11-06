-- Optional: labels shared Echo devices ("Kitchen", "Show 15"). Not used to
-- resolve the reader: shared devices can't identify who is speaking. The
-- device id is regenerated if the skill is disabled and re-enabled, so rows can go stale.
create table if not exists alexa_devices (
  device_id text primary key,
  family_id uuid not null references families (id) on delete cascade,
  profile_id uuid references profiles (id) on delete set null,
  label text,
  last_seen_at timestamptz not null default now()
)
