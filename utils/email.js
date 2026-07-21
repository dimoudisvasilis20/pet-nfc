const { Resend } = require("resend");

// The Resend SDK throws immediately in its constructor if the key is
// missing/empty — constructing it lazily (only once actually sending) means
// a blank RESEND_API_KEY in local dev doesn't crash the whole server on boot.
let resend = null;

// Not fatal if this fails (e.g. RESEND_API_KEY missing in local dev) —
// registration itself should still succeed, so callers only log the error.
async function sendWelcomeEmail(to, firstName, verifyUrl) {

    if (!process.env.RESEND_API_KEY) {
        throw new Error("RESEND_API_KEY is not set");
    }

    if (!resend) {
        resend = new Resend(process.env.RESEND_API_KEY);
    }

    const result = await resend.emails.send({
        from: process.env.EMAIL_FROM || "PawTrace <onboarding@resend.dev>",
        to,
        subject: "Καλώς ήρθες στο PawTrace 🐾",
        html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1e293b;">
                <h1 style="color:#2563eb;">Καλώς ήρθες, ${firstName}! 🐾</h1>
                <p>Ευχαριστούμε που έγινες μέλος του PawTrace. Πριν ξεκινήσεις, επιβεβαίωσε το email σου πατώντας το παρακάτω κουμπί:</p>
                <p style="text-align:center;margin:32px 0;">
                    <a href="${verifyUrl}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Επιβεβαίωση email</a>
                </p>
                <p style="color:#64748b;font-size:13px;">Αν το κουμπί δεν δουλεύει, αντέγραψε αυτόν τον σύνδεσμο στον browser σου:<br>${verifyUrl}</p>
            </div>
        `
    });

    // The Resend SDK doesn't throw on API-level failures (invalid recipient,
    // sandbox restrictions, etc.) — it resolves with { error }. Throwing here
    // is what lets the best-effort try/catch at the call site actually see
    // and log a failed send instead of it looking like it succeeded.
    if (result.error) {
        throw new Error(result.error.message || "Resend API error");
    }

}

module.exports = { sendWelcomeEmail };
