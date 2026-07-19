// Sends a push notification through Expo's push service — no API key
// needed, just the recipient's Expo push token (obtained client-side via
// expo-notifications and stored on users.push_token).
async function sendPushNotification(pushToken, title, body, data = {}) {

    if (!pushToken || !pushToken.startsWith("ExponentPushToken")) {
        return;
    }

    try {

        await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                to: pushToken,
                title,
                body,
                data,
                sound: "default"
            })
        });

    } catch (error) {

        // Best-effort — a failed push should never break the request that
        // triggered it (e.g. someone scanning an NFC tag).
        console.log("Push notification send error:", error.message);

    }

}

module.exports = { sendPushNotification };
