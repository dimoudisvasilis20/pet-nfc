require("dotenv").config({ quiet: true }); // suppresses dotenv's promotional console "tips"

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const cookieSignature = require("cookie-signature");
const rateLimit = require("express-rate-limit");
const pool = require("./db/database");

const authRoutes = require("./routes/auth");
const petRoutes = require("./routes/pets");
const tagRoutes = require("./routes/tags");
const dashboardRoutes = require("./routes/dashboard");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");
const publicRoutes = require("./routes/public");
const locationRoutes = require("./routes/location");
const scanRoutes = require("./routes/scans");
const accountRoutes = require("./routes/account");
const calendarRoutes = require("./routes/calendar");
const { sendDueCalendarReminders } = require("./utils/calendarReminders");

const app = express();

// Render sets this on every service automatically — a more reliable "are we
// live" signal than NODE_ENV, which nothing here ever sets.
const isProduction = !!process.env.RENDER;

// Render (like most PaaS) puts the app behind a reverse proxy — without this,
// every request looks like it comes from that proxy's own IP, not the real
// client. That would make the rate limiter below key everyone off the same
// "IP", so one abusive client could lock out every other user.
if (isProduction) {
    app.set("trust proxy", 1);
}

app.use(helmet({
    // The site's pages all use plain inline <script> blocks (no nonces/hashes
    // set up) — helmet's default CSP would block every one of them. The rest
    // of helmet's headers (X-Content-Type-Options, X-Frame-Options, HSTS,
    // etc.) don't require any of that, so keep those and skip only CSP.
    contentSecurityPolicy: false,
}));

// Only these origins can make credentialed (cookie-bearing) requests —
// keeps a malicious third-party site from riding a logged-in user's session
// via CORS. Requests with no Origin header (the native mobile app, curl,
// server-to-server) aren't browser-mediated so this check doesn't apply to
// them regardless.
const ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:8082",
    "https://pet-nfc-6863.onrender.com",
];

app.use(cors({
    origin: (origin, callback) => {

        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            return callback(null, true);
        }

        callback(new Error("Not allowed by CORS"));

    },
    credentials: true
}));
app.use(express.json());

// The mobile app's cookie jar doesn't reliably survive an app restart (a
// known React Native limitation — browsers don't have this problem). As a
// fallback, it stores the raw session id itself and resends it as this
// header; translate that back into the same signed cookie format
// express-session expects, so it loads the existing session exactly as a
// real cookie would. Only kicks in when there's no real cookie already —
// the website never sends this header, so it's unaffected.
const SESSION_SECRET = process.env.SESSION_SECRET || "pet-nfc-secret-key";

app.use((req, res, next) => {

    const mobileSessionId = req.headers["x-session-id"];

    if (mobileSessionId && !req.headers.cookie) {

        const signed = "s:" + cookieSignature.sign(mobileSessionId, SESSION_SECRET);
        req.headers.cookie = `connect.sid=${encodeURIComponent(signed)}`;

    }

    next();

});

app.use(session({
    // Without a real store, express-session keeps sessions in server RAM —
    // wiped on every restart, which on Render's free tier means every
    // idle-spin-down effectively logs everyone out regardless of the cookie's
    // maxAge below. Storing sessions in Postgres (same DB we already have)
    // makes them survive restarts; createTableIfMissing sets up the
    // "session" table itself, no manual migration needed.
    store: new pgSession({ pool, createTableIfMissing: true }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        httpOnly: true,                   // not readable from page JS
        secure: isProduction,             // HTTPS-only in production; localhost dev is plain HTTP
        sameSite: "lax",                  // cookie isn't sent on cross-site requests (blocks CSRF-by-fetch)
    }
}));

// Slows down credential-guessing against login/register/Google sign-in —
// generous enough not to bother a real user mistyping their password a few
// times, strict enough to make scripted brute-forcing impractical.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Πολλές προσπάθειες — δοκίμασε ξανά σε λίγα λεπτά.",
});

app.use(["/login", "/register", "/auth/google/mobile"], authLimiter);

// Static frontend (login.html, dashboard.html, add-pet.html, lost-pets.html, admin/...)
app.use(express.static("public"));

// API routes
app.use(authRoutes);          // /register, /login
app.use(petRoutes);           // /pets, /pets/:id, /pets/:id/lost, /pets/:id/found, /pets/lost/nearby
app.use(tagRoutes);           // /tags
app.use(dashboardRoutes);     // /dashboard
app.use(notificationRoutes);  // /notifications
app.use(adminRoutes);         // /admin/*
app.use(publicRoutes);        // /p/:code  <- what the NFC tag URL opens, no login needed
app.use(locationRoutes);      // /me/location  <- opt in to lost-pet alerts
app.use(scanRoutes);          // /scans
app.use(accountRoutes);       // /me, /me/password  <- view/edit profile, change password, delete account
app.use(calendarRoutes);      // /calendar-events    <- vet/groomer appointments & medication reminders

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Periodic check for calendar events (vet/groomer/medication) whose date has
// arrived, so a push reminder goes out even if nobody has the app open.
// Simple setInterval rather than a cron library — good enough at this scale,
// and Render's free tier spins the service down when idle anyway, so a
// perfectly precise schedule isn't achievable here regardless.
const CALENDAR_REMINDER_INTERVAL_MS = 15 * 60 * 1000;
sendDueCalendarReminders();
setInterval(sendDueCalendarReminders, CALENDAR_REMINDER_INTERVAL_MS);
