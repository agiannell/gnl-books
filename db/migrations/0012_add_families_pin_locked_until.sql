-- While this is in the future, parent unlocks are refused. Null means not locked.
alter table families add column if not exists pin_locked_until timestamptz
