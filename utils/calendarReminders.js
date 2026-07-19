const pool = require("../db/database");
const { createNotification } = require("./notify");

const TYPE_LABELS = {
    vet: "Επίσκεψη στον κτηνίατρο",
    groomer: "Ραντεβού groomer",
    medication: "Χορήγηση φαρμάκου",
};

// Sends a push (with "OK" / "Υπενθύμιση σε 1 ώρα" action buttons, handled
// client-side) for any scheduled event whose date has arrived and hasn't
// been reminded about yet. calendar_events.event_date has no time-of-day,
// so "arrived" just means today or earlier — this is checked periodically
// from server.js, not tied to a specific hour.
async function sendDueCalendarReminders() {

    try {

        const result = await pool.query(
            `
            SELECT calendar_events.*, pets.name AS pet_name
            FROM calendar_events
            JOIN pets ON calendar_events.pet_id = pets.id
            WHERE calendar_events.status = 'scheduled'
            AND calendar_events.reminder_sent = FALSE
            AND calendar_events.event_date <= CURRENT_DATE
            `
        );

        for (const event of result.rows) {

            const label = TYPE_LABELS[event.type] || event.title;

            await createNotification(
                event.user_id,
                `Υπενθύμιση: ${event.title}`,
                `${label} για τον/την ${event.pet_name} σήμερα.`,
                { type: "calendar_reminder", eventId: event.id, petId: event.pet_id },
                "calendar_reminder"
            );

            await pool.query(
                "UPDATE calendar_events SET reminder_sent = TRUE WHERE id = $1",
                [event.id]
            );

        }

    } catch (error) {

        console.log("Calendar reminder check error:", error);

    }

}

module.exports = { sendDueCalendarReminders };
