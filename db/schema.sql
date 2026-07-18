-- Pet NFC Platform - database schema (PostgreSQL)
-- Run once against a fresh database, e.g.:
--   createdb pet_nfc
--   psql -d pet_nfc -f db/schema.sql

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(30),
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',        -- 'user' or 'admin'
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
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
    vet_name VARCHAR(150),
    vet_phone VARCHAR(30),

    -- lost-pet mode
    is_lost BOOLEAN NOT NULL DEFAULT FALSE,
    lost_at TIMESTAMP,
    last_seen_lat DOUBLE PRECISION,
    last_seen_lng DOUBLE PRECISION,

    -- last time the pet's own details (not photo) were edited; NULL = never.
    -- Details can only be edited once every 6 months — see PUT /pets/:id.
    details_updated_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT NOW()
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
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'completed'
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pets_user_id ON pets(user_id);
CREATE INDEX IF NOT EXISTS idx_pets_is_lost ON pets(is_lost);
CREATE INDEX IF NOT EXISTS idx_tags_pet_id ON tags(pet_id);
CREATE INDEX IF NOT EXISTS idx_tags_public_code ON tags(public_code);
CREATE INDEX IF NOT EXISTS idx_scan_history_tag_id ON scan_history(tag_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_event_date ON calendar_events(event_date);

-- First account you register becomes a regular user; promote yourself to admin with:
--   UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
