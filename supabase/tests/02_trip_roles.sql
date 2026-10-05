-- The role matrix from migration 015 (and src/lib/permissions.ts), checked
-- against the real policies. Each try() is rolled back, so the cases are
-- independent of each other.

-- Stranger: a signed-in user with no link to the trip --------------------------
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('stranger: cannot see the trip',
  (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip')) = 0);
SELECT pg_temp.check('stranger: cannot see flights / participants / members',
  (SELECT count(*) FROM flights WHERE trip_id = pg_temp.id('trip')) = 0
  AND (SELECT count(*) FROM participants WHERE trip_id = pg_temp.id('trip')) = 0
  AND (SELECT count(*) FROM trip_members WHERE trip_id = pg_temp.id('trip')) = 0);
SELECT pg_temp.check('stranger: cannot update the trip',
  pg_temp.try(format('UPDATE trips SET title = %L WHERE id = %L', 'hacked', pg_temp.id('trip'))) = 0);
SELECT pg_temp.check('stranger: cannot add a flight',
  pg_temp.try(format('INSERT INTO flights (trip_id) VALUES (%L)', pg_temp.id('trip'))) = -1);
SELECT pg_temp.check('stranger: cannot see the invite token',
  (SELECT count(*) FROM trip_invites) = 0);
RESET ROLE;

-- Pending and removed members see nothing ---------------------------------------
SELECT pg_temp.login(pg_temp.id('pending'));
SELECT pg_temp.check('pending member: cannot see the trip yet',
  (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip')) = 0);
RESET ROLE;
SELECT pg_temp.login(pg_temp.id('removed'));
SELECT pg_temp.check('removed member: cannot see the trip',
  (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip')) = 0);
SELECT pg_temp.check('removed member: reopening the invite link does not let them back in',
  (SELECT public.accept_trip_invite('test-invite-token') ->> 'status') = 'removed'
  AND (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip')) = 0);
RESET ROLE;

-- Viewer: reads everything shared, writes nothing -------------------------------
SELECT pg_temp.login(pg_temp.id('viewer'));
SELECT pg_temp.check('viewer: sees the trip, flights and participants',
  (SELECT count(*) FROM trips WHERE id = pg_temp.id('trip')) = 1
  AND (SELECT count(*) FROM flights WHERE trip_id = pg_temp.id('trip')) = 1
  AND (SELECT count(*) FROM participants WHERE trip_id = pg_temp.id('trip')) = 1);
SELECT pg_temp.check('viewer: cannot update the trip',
  pg_temp.try(format('UPDATE trips SET title = %L WHERE id = %L', 'x', pg_temp.id('trip'))) = 0);
SELECT pg_temp.check('viewer: cannot add a suggestion',
  pg_temp.try(format('INSERT INTO suggestions (trip_id, title) VALUES (%L, %L)', pg_temp.id('trip'), 'x')) = -1);
SELECT pg_temp.check('viewer: cannot like a suggestion',
  pg_temp.try(format('UPDATE suggestions SET liked = true WHERE trip_id = %L', pg_temp.id('trip'))) = 0);
SELECT pg_temp.check('viewer: cannot add a checklist item',
  pg_temp.try(format('INSERT INTO checklist_items (trip_id, title) VALUES (%L, %L)', pg_temp.id('trip'), 'x')) = -1);
SELECT pg_temp.check('viewer: sees shared checklist items but not the owner''s private ones',
  (SELECT count(*) FROM checklist_items WHERE trip_id = pg_temp.id('trip')) = 1);
SELECT pg_temp.check('viewer: sees "members" documents but not private ones',
  (SELECT array_agg(name) FROM documents WHERE trip_id = pg_temp.id('trip')) = ARRAY['members voucher']);
SELECT pg_temp.check('viewer: cannot read anyone else''s AI chat',
  (SELECT count(*) FROM trip_chat_messages WHERE trip_id = pg_temp.id('trip')) = 0);
SELECT pg_temp.check('viewer: cannot use the AI chat',
  pg_temp.try(format('INSERT INTO trip_chat_messages (trip_id, role, content) VALUES (%L, %L, %L)',
    pg_temp.id('trip'), 'user', 'hi')) = -1);
SELECT pg_temp.check('viewer: sees active members but not pending ones',
  (SELECT count(*) FROM trip_members WHERE trip_id = pg_temp.id('trip') AND status = 'pending') = 0
  AND (SELECT count(*) FROM trip_members WHERE trip_id = pg_temp.id('trip') AND status = 'active') = 3);
RESET ROLE;

-- Participant: checklist, likes, suggestions, updates — not trip details ----------
SELECT pg_temp.login(pg_temp.id('participant'));
SELECT pg_temp.check('participant: can add a suggestion',
  pg_temp.try(format('INSERT INTO suggestions (trip_id, title) VALUES (%L, %L)', pg_temp.id('trip'), 'Pantheon')) = 1);
SELECT pg_temp.check('participant: can like a suggestion',
  pg_temp.try(format('UPDATE suggestions SET liked = true WHERE trip_id = %L', pg_temp.id('trip'))) = 1);
SELECT pg_temp.check('participant: cannot rename a suggestion (only toggle liked)',
  pg_temp.try(format('UPDATE suggestions SET title = %L WHERE trip_id = %L', 'x', pg_temp.id('trip'))) = -1);
SELECT pg_temp.check('participant: cannot delete a suggestion',
  pg_temp.try(format('DELETE FROM suggestions WHERE trip_id = %L', pg_temp.id('trip'))) = 0);
SELECT pg_temp.check('participant: cannot update trip details',
  pg_temp.try(format('UPDATE trips SET title = %L WHERE id = %L', 'x', pg_temp.id('trip'))) = 0);
SELECT pg_temp.check('participant: cannot add a flight',
  pg_temp.try(format('INSERT INTO flights (trip_id) VALUES (%L)', pg_temp.id('trip'))) = -1);
SELECT pg_temp.check('participant: can post a trip update',
  pg_temp.try(format('INSERT INTO trip_updates (trip_id, title) VALUES (%L, %L)', pg_temp.id('trip'), 'hi')) = 1);
SELECT pg_temp.check('participant: cannot post a trip update in someone else''s name',
  pg_temp.try(format('INSERT INTO trip_updates (trip_id, title, created_by) VALUES (%L, %L, %L)',
    pg_temp.id('trip'), 'hi', pg_temp.id('owner'))) = -1);
SELECT pg_temp.check('participant: can tick a shared checklist item',
  pg_temp.try(format('UPDATE checklist_items SET is_done = true WHERE trip_id = %L AND is_shared', pg_temp.id('trip'))) = 1);
SELECT pg_temp.check('participant: cannot pull a shared item into their private list',
  pg_temp.try(format('UPDATE checklist_items SET is_shared = false WHERE trip_id = %L AND is_shared', pg_temp.id('trip'))) = -1);
SELECT pg_temp.check('participant: cannot upload a document row pointing at the owner''s file',
  pg_temp.try(format('INSERT INTO documents (trip_id, name, storage_path, visibility) VALUES (%L, %L, %L, %L)',
    pg_temp.id('trip'), 'steal', pg_temp.id('owner') || '/p.pdf', 'members')) < 1);
SELECT pg_temp.check('participant: cannot delete the owner''s document',
  pg_temp.try(format('DELETE FROM documents WHERE trip_id = %L', pg_temp.id('trip'))) = 0);
SELECT pg_temp.check('participant: cannot approve or promote members',
  pg_temp.try(format('UPDATE trip_members SET role = %L WHERE trip_id = %L', 'editor', pg_temp.id('trip'))) = 0);
RESET ROLE;

-- Editor: everything except delete / sharing / members ----------------------------
SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('editor: can update trip details',
  pg_temp.try(format('UPDATE trips SET title = %L WHERE id = %L', 'Renamed', pg_temp.id('trip'))) = 1);
SELECT pg_temp.check('editor: can add a flight',
  pg_temp.try(format('INSERT INTO flights (trip_id) VALUES (%L)', pg_temp.id('trip'))) = 1);
SELECT pg_temp.check('editor: cannot turn public sharing off/on',
  pg_temp.try(format('UPDATE trips SET is_shared = false WHERE id = %L', pg_temp.id('trip'))) = -1);
SELECT pg_temp.check('editor: cannot take ownership of the trip',
  pg_temp.try(format('UPDATE trips SET user_id = %L WHERE id = %L', pg_temp.id('editor'), pg_temp.id('trip'))) = -1);
SELECT pg_temp.check('editor: cannot delete the trip',
  pg_temp.try(format('DELETE FROM trips WHERE id = %L', pg_temp.id('trip'))) = 0);
SELECT pg_temp.check('editor: cannot see or create invite links',
  (SELECT count(*) FROM trip_invites) = 0
  AND pg_temp.try(format('INSERT INTO trip_invites (trip_id, role) VALUES (%L, %L)', pg_temp.id('trip'), 'viewer')) = -1);
SELECT pg_temp.check('editor: cannot approve pending members',
  pg_temp.try(format('UPDATE trip_members SET status = %L WHERE trip_id = %L AND status = %L',
    'active', pg_temp.id('trip'), 'pending')) = 0);
SELECT pg_temp.check('editor: still cannot see the owner''s private checklist items or documents',
  (SELECT count(*) FROM checklist_items WHERE NOT is_shared) = 0
  AND (SELECT count(*) FROM documents WHERE visibility = 'private') = 0);
RESET ROLE;

-- Owner ---------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('owner: sees pending members and invite links',
  (SELECT count(*) FROM trip_members WHERE status = 'pending') = 1
  AND (SELECT count(*) FROM trip_invites) = 1);
SELECT pg_temp.check('owner: can approve a pending member',
  pg_temp.try(format('UPDATE trip_members SET status = %L WHERE trip_id = %L AND status = %L',
    'active', pg_temp.id('trip'), 'pending')) = 1);
SELECT pg_temp.check('owner: can change sharing',
  pg_temp.try(format('UPDATE trips SET is_shared = false WHERE id = %L', pg_temp.id('trip'))) = 1);
SELECT pg_temp.check('owner: can delete the trip',
  pg_temp.try(format('DELETE FROM trips WHERE id = %L', pg_temp.id('trip'))) = 1);
SELECT pg_temp.check('owner: cannot create a trip in someone else''s name',
  pg_temp.try(format('INSERT INTO trips (user_id, title, destination) VALUES (%L, %L, %L)',
    pg_temp.id('stranger'), 'x', 'y')) = -1);
SELECT pg_temp.check('owner: cannot write AI spend rows directly',
  pg_temp.try(format('INSERT INTO agent_runs (user_id, cost_usd) VALUES (%L, -100)', pg_temp.id('owner'))) = -1);
RESET ROLE;
