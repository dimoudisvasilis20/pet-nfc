const express = require("express");
const pool = require("../db/database");
const requireLogin = require("../middleware/auth");

const router = express.Router();

/*
========================================
USER DASHBOARD
========================================
*/

router.get("/dashboard", requireLogin, async (req, res) => {

    try {

        const userResult = await pool.query(
            `
            SELECT
                first_name,
                last_name,
                email
            FROM users
            WHERE id = $1
            `,
            [req.session.user_id]
        );

        const petsResult = await pool.query(
            `
            SELECT
                pets.*,
                tags.public_code,
                tags.serial_number,
                tags.status AS tag_status

            FROM pets

            LEFT JOIN tags
            ON pets.id = tags.pet_id

            WHERE pets.user_id = $1
            `,
            [req.session.user_id]
        );

        res.json({

            user: userResult.rows[0],

            pets: petsResult.rows

        });

    }
    catch (error) {

        console.log(error);

        res.status(500).send("Dashboard error");

    }

});

module.exports = router;