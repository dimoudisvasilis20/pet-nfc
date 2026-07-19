const pool = require("../db/database");
const { sendPushNotification } = require("./push");

// Creates a notifications row and, if the recipient has a push token on
// file, also fires an Expo push notification — the single place both need
// to happen together so call sites can't add one and forget the other.
//
// `data` (e.g. {type: "nfc_scan", petId: 5}) is stored alongside the
// notification and also sent as the push payload's data field, so tapping
// either the push or the in-app notification row can deep-link to the
// relevant screen instead of just opening the app.
async function createNotification(userId, title, message, data = null) {

    const result = await pool.query(
        `
        INSERT INTO notifications (user_id, title, message, data)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        `,
        [userId, title, message, data ? JSON.stringify(data) : null]
    );

    const user = await pool.query(
        "SELECT push_token FROM users WHERE id = $1",
        [userId]
    );

    if (user.rows[0]?.push_token) {

        await sendPushNotification(user.rows[0].push_token, title, message, data || {});

    }

    return result.rows[0];

}

module.exports = { createNotification };
