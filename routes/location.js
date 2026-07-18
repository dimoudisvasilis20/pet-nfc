const express = require("express");
const pool = require("../db/database");
const requireLogin = require("../middleware/auth");

const router = express.Router();

/*
========================================
OPT IN / UPDATE MY LOCATION
(used for "lost pet nearby" alerts)
========================================
*/

router.post("/me/location", requireLogin, async (req, res) => {

    const { lat, lng, alert_radius_km } = req.body;

    if (typeof lat !== "number" || typeof lng !== "number") {

        return res.status(400).send("lat and lng (numbers) are required");

    }

    try {

        await pool.query(
            `
            INSERT INTO user_locations (user_id, lat, lng, alert_radius_km, updated_at)
            VALUES ($1, $2, $3, COALESCE($4, 10), NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET
                lat = EXCLUDED.lat,
                lng = EXCLUDED.lng,
                alert_radius_km = COALESCE($4, user_locations.alert_radius_km),
                updated_at = NOW()
            `,
            [req.session.user_id, lat, lng, alert_radius_km || null]
        );

        res.json({ message: "Location updated" });

    } catch (error) {

        console.log(error);
        res.status(500).send("Location update error");

    }

});

/*
========================================
OPT OUT
========================================
*/

router.delete("/me/location", requireLogin, async (req, res) => {

    try {

        await pool.query(
            "DELETE FROM user_locations WHERE user_id = $1",
            [req.session.user_id]
        );

        res.json({ message: "Location alerts disabled" });

    } catch (error) {

        console.log(error);
        res.status(500).send("Location delete error");

    }

});

module.exports = router;
