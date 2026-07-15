-- OPTIONAL: live sync. Run this in the Supabase SQL editor and edits made
-- by one family member appear on everyone else's open screens within ~1s.
-- Without it the app still syncs — on sign-in and whenever a window
-- regains focus.
alter publication supabase_realtime add table person;
alter publication supabase_realtime add table relationship;
alter publication supabase_realtime add table nickname;
alter publication supabase_realtime add table memorial;
alter publication supabase_realtime add table nucleus;
