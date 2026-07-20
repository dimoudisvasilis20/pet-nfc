require("dotenv").config();

const { Pool, types } = require("pg");

// DATE columns (OID 1082) default to JS Date objects, which pg constructs in
// local time and Express then serializes to UTC — shifting the date by a day
// depending on server timezone. Keep them as plain 'YYYY-MM-DD' strings instead.
types.setTypeParser(1082, (value) => value);

// Same reasoning as DATE (OID 1082) above: keep TIME columns (OID 1083) as
// plain 'HH:MM:SS' strings instead of letting pg wrap them in a JS Date.
types.setTypeParser(1083, (value) => value);

// Most cloud Postgres providers (Render, Railway, Neon, Supabase...) hand out
// a single DATABASE_URL and require SSL; local dev keeps using the discrete
// DB_* vars against a plain local Postgres with no SSL.
const pool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    })
    : new Pool({

        host: process.env.DB_HOST,

        port: process.env.DB_PORT,

        database: process.env.DB_NAME,

        user: process.env.DB_USER,

        password: process.env.DB_PASSWORD

    });

// pg emits 'error' on the pool whenever an already-connected, idle client
// hits a problem (backend restart, network blip, cloud provider recycling
// the connection, etc). Without a listener here, that's an unhandled error
// event and Node crashes the whole process — which is why the server was
// dying shortly after boot on Render instead of just logging and continuing.
pool.on("error", (error) => {

    console.log("❌ PostgreSQL pool error (connection recovered automatically)");
    console.log(error);

});

pool.connect()
    .then(async (client) => {

        console.log("✅ PostgreSQL Connected");
        client.release();

        // Lightweight, idempotent schema patch — no migration framework here,
        // so new columns just get added on boot the same way past ones were
        // added by hand (see db/schema.sql, which is kept in sync as ground
        // truth). Runs against whichever DB this process is pointed at
        // (local dev or Render), so a deploy is all that's needed to apply it.
        try {

            await pool.query(
                "ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT FALSE"
            );

        } catch (error) {

            console.log("❌ Migration error (calendar_events.reminder_sent):", error.message);

        }

        try {

            await pool.query(
                "ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS event_time TIME"
            );

        } catch (error) {

            console.log("❌ Migration error (calendar_events.event_time):", error.message);

        }

    })
    .catch((error) => {

        console.log("❌ PostgreSQL Error");
        console.log(error);

    });

module.exports = pool;