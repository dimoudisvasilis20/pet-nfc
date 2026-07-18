const express = require("express");
const pool = require("../db/database");
const requireLogin = require("../middleware/auth");

const router = express.Router();

/*
========================================
USER NOTIFICATIONS
========================================
*/

router.get("/notifications", requireLogin, async (req, res) => {

    try {

        const result = await pool.query(
            `
            SELECT *
            FROM notifications
            WHERE user_id = $1
            ORDER BY created_at DESC
            `,
            [req.session.user_id]
        );

        res.json(result.rows);

    } catch (error) {

        console.log(error);
        res.status(500).send("Notifications error");

    }

});

/*
========================================
MARK AS READ
========================================
*/

router.put("/notifications/:id/read", requireLogin, async (req, res) => {

    try {

        await pool.query(
            `
            UPDATE notifications
            SET is_read = true
            WHERE id = $1
            AND user_id = $2
            `,
            [
                req.params.id,
                req.session.user_id
            ]
        );

        res.json({
            message: "Notification updated"
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Update error");

    }

});

/*
========================================
DELETE NOTIFICATION
========================================
*/

router.delete("/notifications/:id", requireLogin, async (req, res) => {

    try {

        await pool.query(
            `
            DELETE FROM notifications
            WHERE id = $1
            AND user_id = $2
            `,
            [
                req.params.id,
                req.session.user_id
            ]
        );

        res.json({
            message: "Notification deleted"
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Delete error");

    }

});

module.exports = router;