-- One open request per user, and the lookup when the user asks again or creates a family.
create unique index async if not exists join_requests_sub_idx on join_requests (cognito_sub)
