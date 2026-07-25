// Sends a push notification through Expo's push service — no API key
// needed, just the recipient's Expo push token (obtained client-side via
// expo-notifications and stored on users.push_token).
async function sendPushNotification(pushToken, title, body, data = {}, categoryId = null) {

    if (!pushToken || !pushToken.startsWith("ExponentPushToken")) {
        console.log(`⚠️ Push not sent (no/invalid token): "${title}"`);
        return;
    }

    try {

        const response = await fetch("https://exp.host/--/api/v2/push/send", {
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
                sound: "default",
                // Lets the client attach action buttons (e.g. "OK" / "Υπενθύμιση
                // σε 1 ώρα" on a calendar reminder) — the category itself is
                // registered client-side, this just tells Expo which one to use.
                ...(categoryId ? { categoryId } : {})
            })
        });

        // Expo's push endpoint responds 200 even when the push itself
        // failed (bad/expired token, missing FCM credentials, etc.) — the
        // real result is per-ticket inside the body, so without reading it
        // a silently-failing push looked identical to a successful one.
        const result = await response.json();
        const ticket = Array.isArray(result.data) ? result.data[0] : result.data;

        if (!response.ok || (ticket && ticket.status === "error")) {
            console.log(`❌ Expo push error for "${title}":`, JSON.stringify(result));
        }

    } catch (error) {

        // Best-effort — a failed push should never break the request that
        // triggered it (e.g. someone scanning an NFC tag).
        console.log("Push notification send error:", error.message);

    }

}

module.exports = { sendPushNotification };
