-- ============================================================================
-- break-ui fixtures for the trip screen (TripLayout + HomeTab). LOCAL DB ONLY.
-- Loaded by scripts/seed-break-ui.mjs, which passes the owner as :'uid'.
-- Idempotent: deletes its five fixed-id trips (children cascade) and recreates
-- them. Dates are relative to current_date so each state stays true over time.
--
--   …01 Demo        the kind data the screen was designed against
--   …02 Worst case  ongoing trip, every realistic long/odd value at once
--   …03 Empty       wizard-created trip with no dates and nothing else
--   …04 One         one day, one participant, one flight, starts tomorrow
--   …05 Huge        ended trip, 120 participants, 150 updates, 12 stays
-- ============================================================================

DELETE FROM trips WHERE id IN (
  'b4ea0000-0000-4000-8000-000000000001', 'b4ea0000-0000-4000-8000-000000000002',
  'b4ea0000-0000-4000-8000-000000000003', 'b4ea0000-0000-4000-8000-000000000004',
  'b4ea0000-0000-4000-8000-000000000005');

-- Demo --------------------------------------------------------------------------
INSERT INTO trips (id, user_id, title, destination, start_date, end_date, cover_emoji)
VALUES ('b4ea0000-0000-4000-8000-000000000001', :'uid', 'חופשה ברומא', 'רומא, איטליה',
        current_date + 40, current_date + 45, '🇮🇹');
-- Shared, so the public brochure can be checked at /share/breakui-demo.
UPDATE trips SET is_shared = true, share_slug = 'breakui-demo' WHERE id = 'b4ea0000-0000-4000-8000-000000000001';
INSERT INTO participants (trip_id, name) SELECT 'b4ea0000-0000-4000-8000-000000000001', n
  FROM unnest(ARRAY['רועי', 'מיכל', 'נועה', 'איתי']) n;
INSERT INTO flights (trip_id, direction, airline, flight_number, from_airport, to_airport, depart_at) VALUES
  ('b4ea0000-0000-4000-8000-000000000001', 'outbound', 'אל על', 'LY383', 'TLV', 'FCO', (current_date + 40) + time '08:10'),
  ('b4ea0000-0000-4000-8000-000000000001', 'inbound',  'אל על', 'LY386', 'FCO', 'TLV', (current_date + 45) + time '16:40');
INSERT INTO stays (trip_id, hotel_name, check_in, check_out) VALUES
  ('b4ea0000-0000-4000-8000-000000000001', 'Hotel Artemide', current_date + 40, current_date + 45);
INSERT INTO trip_updates (trip_id, title, body, kind, is_pinned) VALUES
  ('b4ea0000-0000-4000-8000-000000000001', 'מפגש בשדה ב-05:30', 'ליד דלפקי אל על, טרמינל 3', 'info', true);

-- Worst case --------------------------------------------------------------------
INSERT INTO trips (id, user_id, title, destination, start_date, end_date, cover_emoji,
                   guide_name, guide_phone, photos_album_url)
VALUES ('b4ea0000-0000-4000-8000-000000000002', :'uid',
        'טיול משפחות אברהמי-רוזנבלום ושות׳ לצפון איטליה ולשווייץ – קיץ 2027 (כולל סבא וסבתא!)',
        'מילאנו, אגם קומו, לוצרן, אינטרלאקן, ציריך וחזרה דרך מינכן',
        current_date - 3, current_date + 1, NULL,
        'אלכסנדרה ויסניבסקה-קובלצ׳יק (מדריכה ראשית מטעם החברה)',
        '052-1234567 (וואטסאפ בלבד)',
        'https://photos.google.com/share/AF1QipNk3vX9yR2mT8qLwZ5bH7cJ4dE6fG1hI0jK2lM3nO4pQ5rS6tU7vW8xY9zA?key=VGhpc0lzQUxvbmdLZXlGb3JUZXN0aW5n');
INSERT INTO participants (trip_id, name) VALUES ('b4ea0000-0000-4000-8000-000000000002', 'סבתא שושנה');
INSERT INTO flights (trip_id, direction, airline, flight_number, from_airport, to_airport, depart_at) VALUES
  ('b4ea0000-0000-4000-8000-000000000002', 'outbound', 'Lufthansa CityLine', 'LH687/LH5720', 'TLV', 'MXP', (current_date - 3) + time '05:50'),
  ('b4ea0000-0000-4000-8000-000000000002', 'inbound', 'Swiss International Air Lines', 'LX256',
   'נמל התעופה ציריך (ZRH) טרמינל 2', 'TLV', (current_date + 1) + time '23:55');
INSERT INTO stays (trip_id, hotel_name, check_in, check_out) VALUES
  ('b4ea0000-0000-4000-8000-000000000002', 'Grand Hotel Villa Serbelloni – Bellagio, Lake Como (חדר משפחתי עם מרפסת לאגם)', current_date - 3, current_date - 1),
  ('b4ea0000-0000-4000-8000-000000000002', 'דירת Airbnb אצל Hans-Peter Müller-Lüdenscheidt', NULL, NULL),
  ('b4ea0000-0000-4000-8000-000000000002', 'Hotel Schweizerhof Luzern', current_date - 1, current_date + 1);
INSERT INTO itinerary_items (trip_id, day_date, start_time, title, category, sort_order) VALUES
  ('b4ea0000-0000-4000-8000-000000000002', current_date, '08:15', 'שייט באגם לוצרן עד ויצנאו ועלייה ברכבת השיניים לפסגת הריגי (הכרטיסים במייל של אבא)', 'activity', 1),
  ('b4ea0000-0000-4000-8000-000000000002', current_date, NULL, 'Lindt Home of Chocolate – guided tour + workshop', 'food', 2),
  ('b4ea0000-0000-4000-8000-000000000002', current_date, '19:30', 'ארוחת ערב', 'food', 3);
INSERT INTO trip_updates (trip_id, title, body, kind, is_pinned, created_at) VALUES
  ('b4ea0000-0000-4000-8000-000000000002',
   'מקום המפגש השתנה: https://maps.app.goo.gl/q7XyZ3kLmN9pR2sT6wVb',
   E'מי שלא קיבל את המייל, הוא נשלח מ-bartholomew.fitzgerald@northwind-industries-holdings.example.com\nתבדקו בספאם!!',
   'urgent', true, now()),
  ('b4ea0000-0000-4000-8000-000000000002', 'שימו לב', 'הרכבת של 07:12 בוטלה, יוצאים ב-07:42 מרציף 4. מי שמאחר — נפגשים ישר בתחנה.', 'warning', false, now() - interval '1 hour'),
  ('b4ea0000-0000-4000-8000-000000000002', 'ת', NULL, 'info', false, now() - interval '2 hours');

-- Empty ---------------------------------------------------------------------------
INSERT INTO trips (id, user_id, title, destination)
VALUES ('b4ea0000-0000-4000-8000-000000000003', :'uid', 'טיול', 'יעד סודי');
UPDATE trips SET cover_emoji = '🏝️' WHERE id = 'b4ea0000-0000-4000-8000-000000000003';

-- One -----------------------------------------------------------------------------
INSERT INTO trips (id, user_id, title, destination, start_date, end_date)
VALUES ('b4ea0000-0000-4000-8000-000000000004', :'uid', 'יום באתונה', 'אתונה, יוון', current_date + 1, current_date + 1);
INSERT INTO participants (trip_id, name) VALUES ('b4ea0000-0000-4000-8000-000000000004', 'עדי');
INSERT INTO flights (trip_id, direction, from_airport, to_airport, depart_at) VALUES
  ('b4ea0000-0000-4000-8000-000000000004', 'outbound', 'TLV', 'ATH', (current_date + 1) + time '06:00');
INSERT INTO stays (trip_id, hotel_name) VALUES ('b4ea0000-0000-4000-8000-000000000004', 'לא צריך — חוזרים באותו יום');

-- Huge / ended ---------------------------------------------------------------------
INSERT INTO trips (id, user_id, title, destination, start_date, end_date, cover_emoji)
VALUES ('b4ea0000-0000-4000-8000-000000000005', :'uid', 'טיול שכבה י״א לפולין', 'ורשה, פולין',
        current_date - 30, current_date - 22, '🇵🇱');
INSERT INTO participants (trip_id, name)
  SELECT 'b4ea0000-0000-4000-8000-000000000005', 'תלמיד/ה ' || g FROM generate_series(1, 120) g;
INSERT INTO flights (trip_id, direction, airline, flight_number, from_airport, to_airport, depart_at) VALUES
  ('b4ea0000-0000-4000-8000-000000000005', 'outbound', 'LOT', 'LO152', 'TLV', 'WAW', (current_date - 30) + time '04:30'),
  ('b4ea0000-0000-4000-8000-000000000005', 'inbound',  'LOT', 'LO151', 'WAW', 'TLV', (current_date - 22) + time '22:15');
INSERT INTO stays (trip_id, hotel_name, check_in, check_out)
  SELECT 'b4ea0000-0000-4000-8000-000000000005', 'מלון ' || g, current_date - 30 + (g % 8), current_date - 29 + (g % 8)
  FROM generate_series(1, 12) g;
INSERT INTO trip_updates (trip_id, title, body, kind, is_pinned, created_at)
  SELECT 'b4ea0000-0000-4000-8000-000000000005', 'עדכון יומי #' || g, 'השכמה ב-06:30, ארוחת בוקר ב-07:00, יציאה מהמלון ב-07:45.',
         (ARRAY['info', 'warning', 'urgent'])[1 + g % 3], g % 40 = 0, now() - (g || ' hours')::interval
  FROM generate_series(1, 150) g;

-- Suggestions on the Demo trip, with real Wikipedia page images (the same source
-- `generate` uses), a logo-instead-of-photo miss, and items with no image.
INSERT INTO suggestions (trip_id, kind, title, description, image_url, location) VALUES
  ('b4ea0000-0000-4000-8000-000000000001', 'attraction', 'הקולוסיאום', 'האמפיתיאטרון הגדול של רומא העתיקה. כדאי להזמין כרטיס עם כניסה לפורום.',
   'https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo_2020.jpg/960px-Colosseo_2020.jpg', 'Piazza del Colosseo'),
  ('b4ea0000-0000-4000-8000-000000000001', 'attraction', 'מזרקת טרווי', 'מגיעים מוקדם בבוקר לפני ההמונים, וזורקים מטבע.',
   'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Trevi_Fountain_-_Roma.jpg/960px-Trevi_Fountain_-_Roma.jpg', 'Piazza di Trevi'),
  ('b4ea0000-0000-4000-8000-000000000001', 'attraction', 'הפנתיאון', NULL,
   'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Pantheon_%28Rome%29_-_Right_side_and_front.jpg/960px-Pantheon_%28Rome%29_-_Right_side_and_front.jpg', 'Piazza della Rotonda'),
  ('b4ea0000-0000-4000-8000-000000000001', 'attraction', 'גלריה בורגזה', 'חובה להזמין מראש — נכנסים בחלונות של שעתיים.',
   'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Galleria_Borghese_-_logo_%28Italy%2C_2022-%29.svg/960px-Galleria_Borghese_-_logo_%28Italy%2C_2022-%29.svg.png', 'Piazzale Scipione Borghese'),
  ('b4ea0000-0000-4000-8000-000000000001', 'restaurant', 'Da Enzo al 29', 'טרטוריה רומאית קלאסית בטרסטוורה. תור ארוך בערב.', NULL, 'Trastevere'),
  ('b4ea0000-0000-4000-8000-000000000001', 'tip', 'מים מהברזיות', 'הברזיות העגולות (nasoni) ברחבי העיר — מים קרים וטובים לשתייה.', NULL, NULL);
