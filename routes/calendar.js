const express = require("express");
const pool = require("../db/database");
const requireLogin = require("../middleware/auth");

const router = express.Router();

/*
========================================
GET MY CALENDAR EVENTS
========================================
*/

router.get("/calendar-events", requireLogin, async (req, res) => {

    try {

        const result = await pool.query(
            `
            SELECT
                calendar_events.*,
                pets.name AS pet_name
            FROM calendar_events
            JOIN pets
            ON calendar_events.pet_id = pets.id
            WHERE calendar_events.user_id = $1
            ORDER BY calendar_events.event_date ASC
            `,
            [req.session.user_id]
        );

        res.json(result.rows);

    } catch (error) {

        console.log(error);
        res.status(500).send("Calendar events error");

    }

});

/*
========================================
CREATE CALENDAR EVENT
========================================
*/

router.post("/calendar-events", requireLogin, async (req, res) => {

    const { pet_id, type, title, notes, event_date } = req.body;

    if (!pet_id || !type || !title || !event_date) {

        return res.status(400).send("pet_id, type, title και event_date είναι υποχρεωτικά");

    }

    try {

        const petCheck = await pool.query(
            "SELECT id FROM pets WHERE id=$1 AND user_id=$2",
            [pet_id, req.session.user_id]
        );

        if (petCheck.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        const result = await pool.query(
            `
            INSERT INTO calendar_events
            (user_id, pet_id, type, title, notes, event_date)
            VALUES
            ($1,$2,$3,$4,$5,$6)
            RETURNING *
            `,
            [req.session.user_id, pet_id, type, title, notes || null, event_date]
        );

        res.json({
            message: "Event created",
            event: result.rows[0]
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Event creation error");

    }

});

/*
========================================
RESCHEDULE EVENT (move to another date)
========================================
*/

router.put("/calendar-events/:id/reschedule", requireLogin, async (req, res) => {

    const { event_date } = req.body;

    if (!event_date) {

        return res.status(400).send("event_date is required");

    }

    try {

        const result = await pool.query(
            `
            UPDATE calendar_events
            SET event_date=$1,
                updated_at=NOW()
            WHERE id=$2
            AND user_id=$3
            RETURNING *
            `,
            [event_date, req.params.id, req.session.user_id]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("Event not found");

        }

        res.json({
            message: "Event rescheduled",
            event: result.rows[0]
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Reschedule error");

    }

});

/*
========================================
MARK EVENT AS COMPLETED
========================================
*/

router.put("/calendar-events/:id/complete", requireLogin, async (req, res) => {

    try {

        const result = await pool.query(
            `
            UPDATE calendar_events
            SET status='completed',
                updated_at=NOW()
            WHERE id=$1
            AND user_id=$2
            RETURNING *
            `,
            [req.params.id, req.session.user_id]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("Event not found");

        }

        res.json({
            message: "Event marked as completed",
            event: result.rows[0]
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Complete error");

    }

});

/*
========================================
DELETE EVENT
========================================
*/

router.delete("/calendar-events/:id", requireLogin, async (req, res) => {

    try {

        await pool.query(
            `
            DELETE FROM calendar_events
            WHERE id=$1
            AND user_id=$2
            `,
            [req.params.id, req.session.user_id]
        );

        res.json({ message: "Event deleted" });

    } catch (error) {

        console.log(error);
        res.status(500).send("Delete error");

    }

});

module.exports = router;
