-- DSQL builds indexes asynchronously; ASYNC is required.
create unique index async if not exists books_source_idx on books (source, source_id)
