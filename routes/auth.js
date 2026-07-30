const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const pool = require("../db/database");
const requireLogin = require("../middleware/auth");
const { sendWelcomeEmail } = require("../utils/email");
const { logError } = require("../utils/errorReporting");
const { getGoogleAuthUrl, getGoogleProfile, verifyGoogleIdToken, findOrCreateGoogleUser } = require("../utils/googleAuth");
const { validateBody, validateQuery, schemas, z } = require("../middleware/validate");

const router = express.Router();

// bcrypt's own hashing cost — 12 rounds is the current OWASP-recommended
// floor (10 was the older default, now considered light for how fast GPUs
// have gotten at brute-forcing bcrypt).
const BCRYPT_ROUNDS = 12;

const registerSchema = z.object({
    first_name: schemas.name,
    last_name: schemas.name,
    email: schemas.email,
    phone: schemas.phone,
    alt_phone: schemas.phone.optional().or(z.literal("")),
    password: schemas.password,
});

const loginSchema = z.object({
    email: schemas.email,
    password: z.string().min(1, "Ο κωδικός είναι υποχρεωτικός").max(72),
});

const googleMobileSchema = z.object({
    idToken: z.string().min(1, "idToken is required"),
});

const verifyEmailQuerySchema = z.object({
    token: z.string().min(1, "Λείπει το token επιβεβαίωσης"),
});

/*
========================================
REGISTER
========================================
*/

router.post("/register", validateBody(registerSchema), async (req, res) => {

    const {
        first_name,
        last_name,
        email,
        phone,
        alt_phone,
        password
    } = req.body;

    try {

        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const verificationToken = crypto.randomBytes(32).toString("hex");

        await pool.query(
            `
            INSERT INTO users
            (
                first_name,
                last_name,
                email,
                phone,
                alt_phone,
                password,
                status,
                email_verification_token
            )
            VALUES
            (
                $1,$2,$3,$4,$5,$6,'active',$7
            )
            `,
            [
                first_name,
                last_name,
                email,
                phone,
                alt_phone || null,
                hashedPassword,
                verificationToken
            ]
        );

        // Best-effort — a broken/missing RESEND_API_KEY shouldn't block
        // account creation, just leave the email unverified.
        try {

            const verifyUrl = `${process.env.APP_BASE_URL || ""}/verify-email.html?token=${verificationToken}`;
            await sendWelcomeEmail(email, first_name, verifyUrl);

        } catch (emailError) {

            logError(emailError);

        }

        res.send("User created successfully");

    } catch (error) {

        logError(error);
        res.status(500).send("Register error");

    }

});

/*
========================================
VERIFY EMAIL
========================================
*/

router.get("/verify-email", validateQuery(verifyEmailQuerySchema), async (req, res) => {

    const { token } = req.query;

    try {

        const result = await pool.query(
            `
            UPDATE users
            SET email_verified = TRUE, email_verification_token = NULL
            WHERE email_verification_token = $1
            RETURNING id
            `,
            [token]
        );

        if (result.rows.length === 0) {

            return res.status(400).json({ message: "Μη έγκυρος ή ήδη χρησιμοποιημένος σύνδεσμος επιβεβαίωσης" });

        }

        res.json({ message: "Το email επιβεβαιώθηκε επιτυχώς" });

    } catch (error) {

        logError(error);
        res.status(500).json({ message: "Σφάλμα επιβεβαίωσης email" });

    }

});

/*
========================================
RESEND VERIFICATION EMAIL
Settings > Ασφάλεια shows this only while the account is unverified — the
original email at registration is best-effort and can fail silently
(missing/misconfigured Resend setup), so this is the user's only way to
get another one without contacting support.
========================================
*/

router.post("/resend-verification-email", requireLogin, async (req, res) => {

    try {

        const user = await pool.query(
            "SELECT first_name, email, email_verified FROM users WHERE id=$1",
            [req.session.user_id]
        );

        if (user.rows.length === 0) {

            return res.status(404).send("User not found");

        }

        if (user.rows[0].email_verified) {

            return res.status(400).send("Το email σου είναι ήδη επιβεβαιωμένο.");

        }

        // Fresh token each time — the old one (if the first email did
        // arrive) should stop working once a new one is issued.
        const verificationToken = crypto.randomBytes(32).toString("hex");

        await pool.query(
            "UPDATE users SET email_verification_token=$1 WHERE id=$2",
            [verificationToken, req.session.user_id]
        );

        const verifyUrl = `${process.env.APP_BASE_URL || ""}/verify-email.html?token=${verificationToken}`;
        await sendWelcomeEmail(user.rows[0].email, user.rows[0].first_name, verifyUrl);

        res.json({ message: "Το email επιβεβαίωσης στάλθηκε ξανά." });

    } catch (error) {

        logError(error);
        res.status(500).send("Δεν ήταν δυνατή η αποστολή του email. Δοκίμασε ξανά σε λίγο.");

    }

});

/*
========================================
GOOGLE SIGN-IN
========================================
*/

router.get("/auth/google", (req, res) => {

    res.redirect(getGoogleAuthUrl("login"));

});

router.get("/auth/google/callback", async (req, res) => {

    const { code } = req.query;

    if (!code) {

        return res.redirect("/login.html?error=google");

    }

    try {

        const profile = await getGoogleProfile(code);
        const user = await findOrCreateGoogleUser(pool, profile);

        req.session.user_id = user.id;

        res.redirect("/dashboard.html");

    } catch (error) {

        logError(error);
        res.redirect("/login.html?error=google");

    }

});

// Mobile: the app signs in with the native Google Sign-In SDK itself (no
// redirect through us) and just hands over the resulting ID token here to
// establish the same kind of session the website's redirect flow creates.
router.post("/auth/google/mobile", validateBody(googleMobileSchema), async (req, res) => {

    const { idToken } = req.body;

    try {

        const profile = await verifyGoogleIdToken(idToken);
        const user = await findOrCreateGoogleUser(pool, profile);

        req.session.user_id = user.id;

        res.json({
            message: "Login successful",
            user_id: user.id,
            name: user.first_name,
            role: user.role,
            session_token: req.sessionID
        });

    } catch (error) {

        logError(error);
        res.status(401).send("Google sign-in failed");

    }

});

/*
========================================
LOGIN
========================================
*/

router.post("/login", validateBody(loginSchema), async (req, res) => {

    const { email, password } = req.body;

    try {

        const result = await pool.query(
            "SELECT * FROM users WHERE email=$1",
            [email]
        );

        if (result.rows.length === 0) {

            return res.status(401).send("User not found");

        }

        const user = result.rows[0];

        if (!user.password) {

            return res.status(401).send("Ο λογαριασμός αυτός συνδέεται μόνο με Google — χρησιμοποίησε τη \"Σύνδεση με Google\"");

        }

        const match = await bcrypt.compare(
            password,
            user.password
        );

        if (!match) {

            return res.status(401).send("Wrong password");

        }

        req.session.user_id = user.id;

        res.json({
            message: "Login successful",
            user_id: user.id,
            name: user.first_name,
            role: user.role,
            // The mobile app's cookie jar can't be relied on across app
            // restarts — it resends this as a header instead, so include it
            // for every client (harmless for the website, which sticks with
            // the cookie). See server.js for how it's read back.
            session_token: req.sessionID
        });

    } catch (error) {

        logError(error);
        res.status(500).send("Login error");

    }

});

/*
========================================
LOGOUT
========================================
*/

router.post("/logout", (req, res) => {

    req.session.destroy(() => {

        res.json({ message: "Logged out" });

    });

});

module.exports = router;