-- Pet NFC Platform - database schema (PostgreSQL)
-- Run once against a fresh database, e.g.:
--   createdb pet_nfc
--   psql -d pet_nfc -f db/schema.sql

-- Note: a "session" table also exists, holding login sessions (server.js) —
-- not created here since connect-pg-simple manages its own schema for it
-- (createTableIfMissing: true), created automatically on first server boot.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(30),
    alt_phone VARCHAR(30), -- optional backup contact number, shown on the public pet page if the first doesn't answer
    password VARCHAR(255), -- NULL for accounts created via Google sign-in (no password to check)
    role VARCHAR(20) NOT NULL DEFAULT 'user',        -- 'user' or 'admin'
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    push_token VARCHAR(200), -- Expo push token for the mobile app, NULL until the user grants notification permission
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    email_verification_token VARCHAR(100),
    google_id VARCHAR(100) -- Google account id, set once the user signs in with Google; links/creates the account
);

CREATE TABLE IF NOT EXISTS pets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    species VARCHAR(50),
    breed VARCHAR(100),
    gender VARCHAR(20),
    birth_date DATE,
    weight NUMERIC(6,2),
    color VARCHAR(50),
    microchip VARCHAR(50),
    medical_notes TEXT,
    distinguishing_features TEXT, -- e.g. "κηλίδα στο δεξί μάτι" — shown on the lost-pet poster
    vet_name VARCHAR(150),
    vet_phone VARCHAR(30),
    photo VARCHAR(500),

    -- lost-pet mode
    is_lost BOOLEAN NOT NULL DEFAULT FALSE,
    lost_at TIMESTAMP,
    last_seen_lat DOUBLE PRECISION,
    last_seen_lng DOUBLE PRECISION,
    reward VARCHAR(100), -- optional free-text reward offered, e.g. "50€"
    last_seen_area VARCHAR(200), -- human-readable text (e.g. "Πλατεία Νέας Σμύρνης") for the lost-pet poster; GPS coords aren't printable

    -- last time the pet's own details (not photo) were edited; NULL = never.
    -- Details can only be edited once every 6 months — see PUT /pets/:id.
    details_updated_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    pet_id INTEGER REFERENCES pets(id) ON DELETE CASCADE, -- NULL until an owner pairs the tag
    serial_number VARCHAR(100) UNIQUE NOT NULL,   -- internal manufacturing/inventory code, admin-generated
    public_code VARCHAR(50) UNIQUE NOT NULL,      -- short code written into the NFC URL: /p/<public_code>
    nfc_uid VARCHAR(100) UNIQUE,                  -- hardware UID read from the physical chip, set on pairing
    status VARCHAR(20) NOT NULL DEFAULT 'unassigned' -- 'unassigned' | 'active' | 'inactive' | 'lost' | 'disabled'
        CHECK (status IN ('unassigned', 'active', 'inactive', 'lost', 'disabled')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMP -- when the tag was first paired to a pet
);

CREATE TABLE IF NOT EXISTS scan_history (
    id SERIAL PRIMARY KEY,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    device TEXT,
    browser TEXT,
    scanned_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB, -- {type, ...ids} — lets the app/push tap deep-link to the relevant screen
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One row per user who has opted in to "lost pet near me" alerts.
-- Updated from the browser via Geolocation API; alert_radius_km is user-chosen.
CREATE TABLE IF NOT EXISTS user_locations (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    alert_radius_km NUMERIC(5,1) NOT NULL DEFAULT 10,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Vet / groomer appointments and medication reminders, shown on the "Ημερολόγιο" tab.
CREATE TABLE IF NOT EXISTS calendar_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,                       -- 'vet' | 'groomer' | 'medication'
    title VARCHAR(150) NOT NULL,
    notes TEXT,
    event_date DATE NOT NULL,
    event_time TIME,                                 -- optional time-of-day for the appointment
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'completed'
    reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,     -- push reminder already sent for this event
    recurrence VARCHAR(20) NOT NULL DEFAULT 'none',   -- 'none' | 'daily' | 'weekly' | 'monthly' | 'every_3_months' | 'every_6_months' | 'yearly'
    recurrence_group_id INTEGER,                      -- id of the first occurrence in the series; NULL for one-off events
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- A push token is per-device, not per-account — this makes it structurally
-- impossible for two user rows to hold the same token at once (which would
-- mean one device receiving another account's notifications).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_push_token_unique ON users(push_token) WHERE push_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id_unique ON users(google_id) WHERE google_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pets_user_id ON pets(user_id);
CREATE INDEX IF NOT EXISTS idx_pets_is_lost ON pets(is_lost);
-- Backs the bounding-box pre-filter in GET /pets/lost/nearby.
CREATE INDEX IF NOT EXISTS idx_pets_lost_location ON pets(last_seen_lat, last_seen_lng) WHERE is_lost = TRUE;
CREATE INDEX IF NOT EXISTS idx_tags_pet_id ON tags(pet_id);
CREATE INDEX IF NOT EXISTS idx_tags_public_code ON tags(public_code);
CREATE INDEX IF NOT EXISTS idx_scan_history_tag_id ON scan_history(tag_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_event_date ON calendar_events(event_date);

-- Grants member_id full co-owner access to owner_id's pets (manage details,
-- appointments, lost/found) — added via "Οικογενειακή διαχείριση", instant,
-- no invite/accept step (member just needs an existing account by email).
CREATE TABLE IF NOT EXISTS pet_shares (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(owner_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_pet_shares_owner_id ON pet_shares(owner_id);
CREATE INDEX IF NOT EXISTS idx_pet_shares_member_id ON pet_shares(member_id);

-- A stranger (not the tag holder) reporting "I think I saw this lost pet" —
-- restricted to email-verified reporters (enforced in POST /pets/:id/sightings)
-- so it isn't a fully anonymous vector for confusing/harassing an owner. All
-- fields are fixed-choice (no free text), including recency/condition — an
-- open message field is the easiest way to turn this into a vector for
-- confusing or harassing the owner. lat/lng are the reporter's own GPS
-- position at submit time, not a typed-in address.
CREATE TABLE IF NOT EXISTS pet_sightings (
    id SERIAL PRIMARY KEY,
    pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    certainty VARCHAR(10) NOT NULL CHECK (certainty IN ('sure', 'maybe')),
    recency VARCHAR(20) NOT NULL DEFAULT 'just_now',
    condition VARCHAR(20) NOT NULL DEFAULT 'unknown',
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    address VARCHAR(150),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pet_sightings_pet_id ON pet_sightings(pet_id);

-- First account you register becomes a regular user; promote yourself to admin with:
--   UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
