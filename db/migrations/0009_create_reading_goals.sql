create table if not exists reading_goals (
  profile_id uuid not null references profiles (id) on delete cascade,
  year int not null,
  target int not null,
  primary key (profile_id, year)
)
