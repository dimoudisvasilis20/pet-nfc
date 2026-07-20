const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db/database");
const requireLogin = require("../middleware/auth");

const router = express.Router();

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
                users.created_at,
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

        console.log(error);
        res.status(500).send("Profile error");

    }

});

/*
========================================
UPDATE MY PROFILE
========================================
*/

router.put("/me", requireLogin, async (req, res) => {

    const { first_name, last_name, email, phone } = req.body;

    try {

        const result = await pool.query(
            `
            UPDATE users
            SET
                first_name = $1,
                last_name = $2,
                email = $3,
                phone = $4,
                updated_at = NOW()
            WHERE id = $5
            RETURNING id, first_name, last_name, email, phone, created_at
            `,
            [first_name, last_name, email, phone, req.session.user_id]
        );

        res.json({
            message: "Profile updated",
            user: result.rows[0]
        });

    } catch (error) {

        if (error.code === "23505") {

            return res.status(409).send("Το email χρησιμοποιείται ήδη");

        }

        console.log(error);
        res.status(500).send("Profile update error");

    }

});

/*
========================================
CHANGE PASSWORD
========================================
*/

router.put("/me/password", requireLogin, async (req, res) => {

    const { current_password, new_password } = req.body;

    if (!new_password || new_password.length < 6) {

        return res.status(400).send("Ο νέος κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες");

    }

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

        const hashedPassword = await bcrypt.hash(new_password, 10);

        await pool.query(
            "UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2",
            [hashedPassword, req.session.user_id]
        );

        res.json({ message: "Password updated" });

    } catch (error) {

        console.log(error);
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

        console.log(error);
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

        console.log(error);
        res.status(500).send("Push token error");

    }

});

module.exports = router;
