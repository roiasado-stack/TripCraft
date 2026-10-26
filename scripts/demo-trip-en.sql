-- English demo trip: Rome, 5 days, a family of 4 — for agencies abroad.
-- Plan: docs/plans/2026-10-26-english-share-page.md (phase 2). The public page
-- shows it in English at /share/<slug>?lang=en.
--
-- How to run: paste the whole file into the SQL Editor (or psql) and run it.
-- Change the email on the first line only; it must be an ACTIVE agent (its
-- agency branding shows on the page). The last statement returns the link.
--
-- Safe to run again: the trip has a fixed id derived from the owner, so a rerun
-- updates the same trip, keeps its share link, moves the dates to 3 weeks from
-- today and rebuilds its flights, hotel, itinerary, suggestions and update.
-- Everything is invented: no real client, no booking refs, no guide phone
-- (so a WhatsApp tap can't reach a stranger). No kosher or Shabbat content.
--
-- Remove it:  DELETE FROM trips WHERE id = md5('tripcraft-demo-en:' || '<owner uuid>')::uuid;

SELECT set_config('demo.email', 'Tripcraft26@gmail.com', false);

DO $$
DECLARE
  v_owner UUID;
  v_trip UUID;
  d0 DATE := current_date + 21;  -- arrival day; the trip is d0 .. d0 + 4
BEGIN
  SELECT u.id INTO v_owner FROM auth.users u WHERE lower(u.email) = lower(current_setting('demo.email'));
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'no user with email %', current_setting('demo.email');
  END IF;
  IF NOT (public.has_role(v_owner, 'agent')
          AND EXISTS (SELECT 1 FROM agent_accounts a WHERE a.user_id = v_owner AND a.status = 'active')) THEN
    RAISE EXCEPTION '% is not an active agent', current_setting('demo.email');
  END IF;
  v_trip := md5('tripcraft-demo-en:' || v_owner)::uuid;

  -- The trip. share_slug keeps its column default on insert and is never
  -- touched on update, so the link Roi already sent keeps working.
  INSERT INTO trips (id, user_id, title, destination, start_date, end_date, trip_type, cover_emoji,
                     guide_name, guide_phone, is_shared, is_showcase, image_url, photos_album_url, notes)
  VALUES (v_trip, v_owner, 'Rome with the kids', 'Rome, Italy', d0, d0 + 4, 'family', '🇮🇹',
          'Giulia, your local guide in Rome', NULL, true, false,
          'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Trevi_Fountain%2C_Rome%2C_Italy_2_-_May_2007.jpg/960px-Trevi_Fountain%2C_Rome%2C_Italy_2_-_May_2007.jpg',
          NULL, 'English demo trip (scripts/demo-trip-en.sql)')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, destination = EXCLUDED.destination,
    start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, trip_type = EXCLUDED.trip_type,
    cover_emoji = EXCLUDED.cover_emoji, guide_name = EXCLUDED.guide_name, guide_phone = EXCLUDED.guide_phone,
    is_shared = true, is_showcase = false, image_url = EXCLUDED.image_url,
    photos_album_url = EXCLUDED.photos_album_url, notes = EXCLUDED.notes
  WHERE trips.user_id = v_owner;

  DELETE FROM flights WHERE trip_id = v_trip;
  DELETE FROM stays WHERE trip_id = v_trip;
  DELETE FROM itinerary_items WHERE trip_id = v_trip;
  DELETE FROM suggestions WHERE trip_id = v_trip;
  DELETE FROM trip_updates WHERE trip_id = v_trip;

  -- Flight times are on the departure airport's clock.
  INSERT INTO flights (trip_id, direction, airline, flight_number, from_airport, to_airport, depart_at, arrive_at) VALUES
    (v_trip, 'outbound', 'ITA Airways', 'AZ 809', 'TLV', 'FCO',
     (d0 + time '06:40') AT TIME ZONE 'Asia/Jerusalem', (d0 + time '09:35') AT TIME ZONE 'Europe/Rome'),
    (v_trip, 'inbound', 'ITA Airways', 'AZ 808', 'FCO', 'TLV',
     (d0 + 4 + time '20:05') AT TIME ZONE 'Europe/Rome', (d0 + 5 + time '00:40') AT TIME ZONE 'Asia/Jerusalem');

  INSERT INTO stays (trip_id, hotel_name, address, check_in, check_out, notes) VALUES
    (v_trip, 'Residenza Navona (family suite)', 'Via dei Coronari 12, 00186 Rome', d0, d0 + 4,
     'Breakfast included. Check-in from 14:00; bags can be left from 10:00.');

  INSERT INTO itinerary_items (trip_id, day_date, start_time, title, description, category, location, sort_order) VALUES
    (v_trip, d0,     '11:00', 'Private transfer to the hotel', 'Your driver waits at arrivals with a sign in the family''s name.', 'transport', 'Fiumicino Airport', 1),
    (v_trip, d0,     '15:30', 'Piazza Navona and gelato', 'An easy first walk: Bernini''s fountains, street artists and the first gelato of the trip.', 'activity', 'Piazza Navona', 2),
    (v_trip, d0,     '19:30', 'Dinner in Trastevere', 'Cobbled lanes and family-run trattorias. Cacio e pepe is a must.', 'food', 'Trastevere', 3),
    (v_trip, d0 + 1, '09:00', 'Colosseum and Roman Forum', 'Timed-entry tickets are in your documents. Guided tour with Giulia, about 3 hours.', 'activity', 'Colosseum', 1),
    (v_trip, d0 + 1, '13:00', 'Lunch in Monti', 'Pizza by the slice in Rome''s village-like neighbourhood.', 'food', 'Monti, Rome', 2),
    (v_trip, d0 + 1, '16:30', 'Free afternoon', 'Pool or nap time at the hotel.', 'free', NULL, 3),
    (v_trip, d0 + 2, '08:30', 'Vatican Museums and Sistine Chapel', 'Skip-the-line entry. Shoulders and knees covered.', 'activity', 'Vatican Museums', 1),
    (v_trip, d0 + 2, '12:30', 'St Peter''s Basilica', 'Climb the dome if the kids still have energy: 551 steps.', 'activity', 'St. Peter''s Basilica', 2),
    (v_trip, d0 + 2, '16:00', 'Castel Sant''Angelo', 'Walk back along the Tiber; the terrace has the best view of St Peter''s.', 'activity', 'Castel Sant''Angelo', 3),
    (v_trip, d0 + 3, '09:30', 'Trevi Fountain and the Pantheon', 'Early, before the crowds. Throw a coin to come back to Rome.', 'activity', 'Trevi Fountain', 1),
    (v_trip, d0 + 3, '11:30', 'Spanish Steps', NULL, 'activity', 'Spanish Steps', 2),
    (v_trip, d0 + 3, '15:00', 'Bikes in Villa Borghese', 'Rent a four-seat surrey bike by the lake.', 'activity', 'Villa Borghese', 3),
    (v_trip, d0 + 4, '09:30', 'Campo de'' Fiori market', 'Last souvenirs: pasta, olive oil, spices.', 'activity', 'Campo de'' Fiori', 1),
    (v_trip, d0 + 4, '11:00', 'Hotel check-out', 'Leave the bags at reception.', 'hotel', 'Via dei Coronari 12, Rome', 2),
    (v_trip, d0 + 4, '17:00', 'Transfer to the airport', 'Pick-up at the hotel entrance.', 'transport', 'Fiumicino Airport', 3);

  INSERT INTO suggestions (trip_id, kind, title, description, location) VALUES
    (v_trip, 'attraction', 'Explora children''s museum', 'Hands-on museum for kids up to 12. Book a slot online.', 'Explora Il Museo dei Bambini di Roma'),
    (v_trip, 'attraction', 'Bioparco di Roma', 'The city zoo, right next to Villa Borghese.', 'Bioparco di Roma'),
    (v_trip, 'restaurant', 'Pizzarium Bonci', 'Famous pizza by the slice near the Vatican. Expect a short queue.', 'Pizzarium Bonci'),
    (v_trip, 'restaurant', 'Giolitti', 'One of Rome''s oldest gelato shops, near the Pantheon.', 'Giolitti, Rome'),
    (v_trip, 'tip', 'Free drinking water everywhere', 'The "nasoni" street fountains have cold, drinkable water. Bring a bottle.', NULL),
    (v_trip, 'gear', 'Comfortable walking shoes', 'Rome is cobblestones all day. Leave the new shoes at home.', NULL);

  INSERT INTO trip_updates (trip_id, title, body, kind, is_pinned) VALUES
    (v_trip, 'Vatican tour: meet at 8:15', 'Giulia will wait at the Vatican Museums entrance, Viale Vaticano. Please be on time: entry is timed.', 'warning', true),
    (v_trip, 'Welcome to Rome!', 'Everything for the trip is on this page. Message us any time.', 'info', false);
END $$;

-- The link to send (append nothing: ?lang=en is already on it).
SELECT 'https://tripcraft-lac.vercel.app/share/' || t.share_slug || '?lang=en' AS english_link,
       t.start_date, t.end_date
FROM trips t
JOIN auth.users u ON t.id = md5('tripcraft-demo-en:' || u.id)::uuid
WHERE lower(u.email) = lower(current_setting('demo.email'));
