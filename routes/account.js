const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db/database");
const requireLogin = require("../middleware/auth");
const { logError } = require("../utils/errorReporting");
const { validateBody, schemas, z } = require("../middleware/validate");

const router = express.Router();

const BCRYPT_ROUNDS = 12;

const updateProfileSchema = z.object({
    first_name: schemas.name,
    last_name: schemas.name,
    email: schemas.email,
    phone: schemas.phone,
    alt_phone: schemas.phone.optional().or(z.literal("")),
});

const changePasswordSchema = z.object({
    current_password: z.string().min(1, "Ο τρέχων κωδικός είναι υποχρεωτικός").max(72),
    new_password: schemas.password,
});

/*
========================================
GET MY PROFILE
========================================
*/

router.get("/me", requireLogin, async (req, res) => {

    try {

        const result = await pool.query(
            `
            SELECT
                users.id,
                users.first_name,
                users.last_name,
                users.email,
                users.phone,
                users.alt_phone,
                users.created_at,
                users.email_verified,
                (users.push_token IS NOT NULL) AS push_enabled,
                (user_locations.user_id IS NOT NULL) AS location_shared
            FROM users
            LEFT JOIN user_locations
                ON user_locations.user_id = users.id
            WHERE users.id = $1
            `,
            [req.session.user_id]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("User not found");

        }

        res.json(result.rows[0]);

    } catch (error) {

        logError(error);
        res.status(500).send("Profile error");

    }

});

/*
========================================
UPDATE MY PROFILE
========================================
*/

router.put("/me", requireLogin, validateBody(updateProfileSchema), async (req, res) => {

    const { first_name, last_name, email, phone, alt_phone } = req.body;

    try {

        const result = await pool.query(
            `
            UPDATE users
            SET
                first_name = $1,
                last_name = $2,
                email = $3,
                phone = $4,
                alt_phone = $5,
                updated_at = NOW()
            WHERE id = $6
            RETURNING id, first_name, last_name, email, phone, alt_phone, created_at
            `,
            [first_name, last_name, email, phone, alt_phone || null, req.session.user_id]
        );

        res.json({
            message: "Profile updated",
            user: result.rows[0]
        });

    } catch (error) {

        if (error.code === "23505") {

            return res.status(409).send("Το email χρησιμοποιείται ήδη");

        }

        logError(error);
        res.status(500).send("Profile update error");

    }

});

/*
========================================
CHANGE PASSWORD
========================================
*/

router.put("/me/password", requireLogin, validateBody(changePasswordSchema), async (req, res) => {

    const { current_password, new_password } = req.body;

    try {

        const result = await pool.query(
            "SELECT password FROM users WHERE id = $1",
            [req.session.user_id]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("User not found");

        }

        const match = await bcrypt.compare(current_password, result.rows[0].password);

        if (!match) {

            return res.status(401).send("Λάθος τρέχων κωδικός");

        }

        const hashedPassword = await bcrypt.hash(new_password, BCRYPT_ROUNDS);

        await pool.query(
            "UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2",
            [hashedPassword, req.session.user_id]
        );

        res.json({ message: "Password updated" });

    } catch (error) {

        logError(error);
        res.status(500).send("Password update error");

    }

});

/*
========================================
DELETE MY ACCOUNT
========================================
*/

router.delete("/me", requireLogin, async (req, res) => {

    const { password } = req.body;

    try {

        const result = await pool.query(
            "SELECT password FROM users WHERE id = $1",
            [req.session.user_id]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("User not found");

        }

        const match = await bcrypt.compare(password || "", result.rows[0].password);

        if (!match) {

            return res.status(401).send("Λάθος κωδικός");

        }

        await pool.query(
            "DELETE FROM users WHERE id = $1",
            [req.session.user_id]
        );

        req.session.destroy(() => {

            res.json({ message: "Account deleted" });

        });

    } catch (error) {

        logError(error);
        res.status(500).send("Account deletion error");

    }

});

/*
========================================
SAVE PUSH TOKEN (mobile app)
========================================
*/

router.put("/me/push-token", requireLogin, async (req, res) => {

    // token: null explicitly clears it (used to turn push notifications
    // off from the app's settings screen without deleting the account).
    const { token } = req.body;

    try {

        // A device's Expo push token is per-device, not per-account — if a
        // different user previously logged in on this same device, their
        // row may still hold this exact token (e.g. if they didn't log out
        // through a path that clears it). Strip it from anyone else first,
        // so a token is only ever attached to the one account currently
        // signed in on that device — otherwise both users would receive
        // each other's notifications.
        if (token) {
            await pool.query(
                "UPDATE users SET push_token = NULL WHERE push_token = $1 AND id != $2",
                [token, req.session.user_id]
            );
        }

        await pool.query(
            "UPDATE users SET push_token = $1 WHERE id = $2",
            [token || null, req.session.user_id]
        );

        res.json({ message: token ? "Push token saved" : "Push token cleared" });

    } catch (error) {

        logError(error);
        res.status(500).send("Push token error");

    }

});

/*
========================================
FAMILY MANAGEMENT (pet_shares)
Members added here get full co-owner access
to every one of my pets — instantly, no
invite/accept step, as long as their email
already has an account with us.
========================================
*/

router.get("/me/family", requireLogin, async (req, res) => {

    try {

        const result = await pool.query(
            `
            SELECT users.id, users.first_name, users.last_name, users.email
            FROM pet_shares
            JOIN users ON users.id = pet_shares.member_id
            WHERE pet_shares.owner_id = $1
            ORDER BY pet_shares.created_at ASC
            `,
            [req.session.user_id]
        );

        res.json(result.rows);

    } catch (error) {

        logError(error);
        res.status(500).send("Family list error");

    }

});

router.post("/me/family", requireLogin, async (req, res) => {

    const { email } = req.body;

    if (!email) {

        return res.status(400).send("Το email είναι υποχρεωτικό");

    }

    try {

        const targetUser = await pool.query(
            "SELECT id, first_name, last_name, email FROM users WHERE email = $1",
            [email]
        );

        if (targetUser.rows.length === 0) {

            return res.status(404).send("Δεν υπάρχει λογαριασμός με αυτό το email");

        }

        const member = targetUser.rows[0];

        if (String(member.id) === String(req.session.user_id)) {

            return res.status(400).send("Δεν μπορείς να προσθέσεις τον εαυτό σου");

        }

        await pool.query(
            `
            INSERT INTO pet_shares (owner_id, member_id)
            VALUES ($1, $2)
            ON CONFLICT (owner_id, member_id) DO NOTHING
            `,
            [req.session.user_id, member.id]
        );

        res.json({ message: "Μέλος προστέθηκε", member });

    } catch (error) {

        logError(error);
        res.status(500).send("Family add error");

    }

});

router.delete("/me/family/:memberId", requireLogin, async (req, res) => {

    try {

        await pool.query(
            "DELETE FROM pet_shares WHERE owner_id = $1 AND member_id = $2",
            [req.session.user_id, req.params.memberId]
        );

        res.json({ message: "Μέλος αφαιρέθηκε" });

    } catch (error) {

        logError(error);
        res.status(500).send("Family remove error");

    }

});

module.exports = router;
