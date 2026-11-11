-- A parent's list of requests, and the per-family cap on open ones.
create index async if not exists join_requests_family_idx on join_requests (family_id, created_at)
