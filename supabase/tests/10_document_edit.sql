-- Changing a document's category or traveller after upload (DocumentsTab). The
-- "uploader update" policy (migration 015) is the authority; canEditDocument in
-- src/lib/document-rules.ts mirrors these cases. The agent board's passport count
-- must follow the change, or the fix doesn't reach the screen that reported it.

INSERT INTO public.documents (trip_id, name, storage_path, uploaded_by, visibility) VALUES
  (pg_temp.id('trip'), 'viewer own',      pg_temp.id('viewer') || '/v.pdf',      pg_temp.id('viewer'),      'members'),
  (pg_temp.id('trip'), 'participant own', pg_temp.id('participant') || '/p.pdf', pg_temp.id('participant'), 'members');

-- Viewer: not even their own document (e.g. uploaded before being demoted) ---------
SELECT pg_temp.login(pg_temp.id('viewer'));
SELECT pg_temp.check('viewer: cannot recategorize a document they uploaded',
  pg_temp.try(format('UPDATE documents SET category = %L WHERE name = %L', 'passport', 'viewer own')) = 0);
SELECT pg_temp.check('viewer: cannot recategorize the owner''s document',
  pg_temp.try(format('UPDATE documents SET category = %L WHERE name = %L', 'passport', 'members voucher')) = 0);
RESET ROLE;

-- Participant: own documents only ---------------------------------------------------
SELECT pg_temp.login(pg_temp.id('participant'));
SELECT pg_temp.check('participant: can recategorize their own document',
  pg_temp.try(format('UPDATE documents SET category = %L WHERE name = %L', 'passport', 'participant own')) = 1);
SELECT pg_temp.check('participant: cannot recategorize the owner''s document',
  pg_temp.try(format('UPDATE documents SET category = %L WHERE name = %L', 'passport', 'members voucher')) = 0);
RESET ROLE;

-- Editor: editing the trip doesn't extend to other people's documents ---------------
SELECT pg_temp.login(pg_temp.id('editor'));
SELECT pg_temp.check('editor: cannot recategorize the owner''s document',
  pg_temp.try(format('UPDATE documents SET category = %L WHERE name = %L', 'passport', 'members voucher')) = 0);
RESET ROLE;

-- Stranger -------------------------------------------------------------------------
SELECT pg_temp.login(pg_temp.id('stranger'));
SELECT pg_temp.check('stranger: cannot recategorize a document',
  pg_temp.try(format('UPDATE documents SET category = %L WHERE name = %L', 'passport', 'members voucher')) = 0);
RESET ROLE;

-- Owner: own document yes, a member's no, and the board's count follows -------------
SELECT pg_temp.login(pg_temp.id('owner'));
SELECT pg_temp.check('owner: cannot recategorize a member''s document',
  pg_temp.try(format('UPDATE documents SET category = %L WHERE name = %L', 'passport', 'participant own')) = 0);
SELECT pg_temp.check('owner: a passport without a traveller is not counted',
  pg_temp.try(format('UPDATE documents SET category = %L WHERE name = %L', 'passport', 'private passport')) = 1
  AND public.trip_passport_count(pg_temp.id('trip')) = 0);
UPDATE documents SET category = 'passport', participant_id = (SELECT id FROM participants WHERE trip_id = pg_temp.id('trip') LIMIT 1)
  WHERE name = 'private passport';
SELECT pg_temp.check('owner: tying an existing passport to a traveller raises the count by one',
  public.trip_passport_count(pg_temp.id('trip')) = 1);
RESET ROLE;
