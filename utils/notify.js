const pool = require("../db/database");
const { sendPushNotification } = require("./push");

// Creates a notifications row and, if the recipient has a push token on
// file, also fires an Expo push notification — the single place both need
// to happen together so call sites can't add one and forget the other.
async function createNotification(userId, title, message) {

    const result = await pool.query(
        `
        INSERT INTO notifications (user_id, title, message)
        VALUES ($1, $2, $3)
        RETURNING *
        `,
        [userId, title, message]
    );

    const user = await pool.query(
        "SELECT push_token FROM users WHERE id = $1",
        [userId]
    );

    if (user.rows[0]?.push_token) {

        await sendPushNotification(user.rows[0].push_token, title, message);

    }

    return result.rows[0];

}

module.exports = { createNotification };
