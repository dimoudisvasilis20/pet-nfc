const express = require("express");
const pool = require("../db/database");
const requireLogin = require("../middleware/auth");

const router = express.Router();

/*
========================================
RECENT SCANS (current user's pets)
========================================
*/

router.get("/scans", requireLogin, async (req, res) => {

    try {

        const result = await pool.query(
            `
            SELECT
                scan_history.*,
                pets.name AS pet_name

            FROM scan_history

            JOIN tags
            ON scan_history.tag_id = tags.id

            JOIN pets
            ON tags.pet_id = pets.id

            WHERE pets.user_id = $1

            ORDER BY scan_history.scanned_at DESC

            LIMIT 50
            `,
            [req.session.user_id]
        );

        res.json(result.rows);

    } catch (error) {

        console.log(error);
        res.status(500).send("Scans error");

    }

});

module.exports = router;
