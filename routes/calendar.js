const express = require("express");
const pool = require("../db/database");
const requireLogin = require("../middleware/auth");

const router = express.Router();

// How far each recurrence type steps forward, and how many future occurrence
// rows to generate up front (bounded so e.g. "daily" doesn't spawn years of rows).
const RECURRENCE_STEPS = {
    daily: { unit: "day", amount: 1, occurrences: 30 },
    weekly: { unit: "day", amount: 7, occurrences: 12 },
    monthly: { unit: "month", amount: 1, occurrences: 12 },
    every_3_months: { unit: "month", amount: 3, occurrences: 8 },
    every_6_months: { unit: "month", amount: 6, occurrences: 8 },
    yearly: { unit: "year", amount: 1, occurrences: 5 },
};

function addInterval(dateStr, unit, amount) {

    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (unit === "day") date.setUTCDate(date.getUTCDate() + amount);
    else if (unit === "month") date.setUTCMonth(date.getUTCMonth() + amount);
    else if (unit === "year") date.setUTCFullYear(date.getUTCFullYear() + amount);

    return date.toISOString().slice(0, 10);

}

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

    const { pet_id, type, title, notes, event_date, event_time, recurrence } = req.body;

    if (!pet_id || !type || !title || !event_date) {

        return res.status(400).send("pet_id, type, title και event_date είναι υποχρεωτικά");

    }

    const recurrenceValue = RECURRENCE_STEPS[recurrence] ? recurrence : "none";

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
            (user_id, pet_id, type, title, notes, event_date, event_time, recurrence)
            VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING *
            `,
            [req.session.user_id, pet_id, type, title, notes || null, event_date, event_time || null, recurrenceValue]
        );

        const event = result.rows[0];

        if (recurrenceValue !== "none") {

            // The first occurrence is its own series head — recurrence_group_id
            // lets every generated occurrence (including this one) be found
            // together later, e.g. if series-wide actions are added.
            await pool.query(
                "UPDATE calendar_events SET recurrence_group_id=id WHERE id=$1",
                [event.id]
            );
            event.recurrence_group_id = event.id;

            const { unit, amount, occurrences } = RECURRENCE_STEPS[recurrenceValue];
            let currentDate = event_date;

            for (let i = 0; i < occurrences; i++) {

                currentDate = addInterval(currentDate, unit, amount);

                await pool.query(
                    `
                    INSERT INTO calendar_events
                    (user_id, pet_id, type, title, notes, event_date, event_time, recurrence, recurrence_group_id)
                    VALUES
                    ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                    `,
                    [req.session.user_id, pet_id, type, title, notes || null, currentDate, event_time || null, recurrenceValue, event.id]
                );

            }

        }

        res.json({
            message: "Event created",
            event
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

    const { event_date, event_time } = req.body;

    if (!event_date) {

        return res.status(400).send("event_date is required");

    }

    try {

        const result = await pool.query(
            `
            UPDATE calendar_events
            SET event_date=$1,
                event_time=COALESCE($2, event_time),
                updated_at=NOW()
            WHERE id=$3
            AND user_id=$4
            RETURNING *
            `,
            [event_date, event_time || null, req.params.id, req.session.user_id]
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
