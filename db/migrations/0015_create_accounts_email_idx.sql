-- Finds the family a join request names by the parent's email.
create index async if not exists accounts_email_idx on accounts (email)
