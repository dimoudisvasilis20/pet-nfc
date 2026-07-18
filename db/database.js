require("dotenv").config();

const { Pool, types } = require("pg");

// DATE columns (OID 1082) default to JS Date objects, which pg constructs in
// local time and Express then serializes to UTC — shifting the date by a day
// depending on server timezone. Keep them as plain 'YYYY-MM-DD' strings instead.
types.setTypeParser(1082, (value) => value);

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

pool.connect()
    .then(() => {

        console.log("✅ PostgreSQL Connected");

    })
    .catch((error) => {

        console.log("❌ PostgreSQL Error");
        console.log(error);

    });

module.exports = pool;