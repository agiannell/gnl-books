-- A profile has at most one entry per book.
create unique index async if not exists shelf_entries_profile_book_idx on shelf_entries (profile_id, book_id)
