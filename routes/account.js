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
                id,
                first_name,
                last_name,
                email,
                phone,
                created_at
            FROM users
            WHERE id = $1
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

module.exports = router;
