const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const pool = require("../db/database");
const { sendWelcomeEmail } = require("../utils/email");
const { getGoogleAuthUrl, getGoogleProfile, verifyGoogleIdToken, findOrCreateGoogleUser } = require("../utils/googleAuth");

const router = express.Router();

/*
========================================
REGISTER
========================================
*/

router.post("/register", async (req, res) => {

    const {
        first_name,
        last_name,
        email,
        phone,
        password
    } = req.body;

    try {

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationToken = crypto.randomBytes(32).toString("hex");

        await pool.query(
            `
            INSERT INTO users
            (
                first_name,
                last_name,
                email,
                phone,
                password,
                status,
                email_verification_token
            )
            VALUES
            (
                $1,$2,$3,$4,$5,'active',$6
            )
            `,
            [
                first_name,
                last_name,
                email,
                phone,
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

            console.log("❌ Welcome email error:", emailError.message);

        }

        res.send("User created successfully");

    } catch (error) {

        console.log(error);
        res.status(500).send("Register error");

    }

});

/*
========================================
VERIFY EMAIL
========================================
*/

router.get("/verify-email", async (req, res) => {

    const { token } = req.query;

    if (!token) {

        return res.status(400).json({ message: "Λείπει το token επιβεβαίωσης" });

    }

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

        console.log(error);
        res.status(500).json({ message: "Σφάλμα επιβεβαίωσης email" });

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

        console.log(error);
        res.redirect("/login.html?error=google");

    }

});

// Mobile: the app signs in with the native Google Sign-In SDK itself (no
// redirect through us) and just hands over the resulting ID token here to
// establish the same kind of session the website's redirect flow creates.
router.post("/auth/google/mobile", async (req, res) => {

    const { idToken } = req.body;

    if (!idToken) {

        return res.status(400).send("idToken is required");

    }

    try {

        const profile = await verifyGoogleIdToken(idToken);
        const user = await findOrCreateGoogleUser(pool, profile);

        req.session.user_id = user.id;

        res.json({
            message: "Login successful",
            user_id: user.id,
            name: user.first_name,
            role: user.role
        });

    } catch (error) {

        console.log(error);
        res.status(401).send("Google sign-in failed");

    }

});

/*
========================================
LOGIN
========================================
*/

router.post("/login", async (req, res) => {

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
            role: user.role
        });

    } catch (error) {

        console.log(error);
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