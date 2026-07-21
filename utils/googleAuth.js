const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

function getGoogleAuthUrl(state) {

    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        response_type: "code",
        scope: "openid email profile",
        state,
        prompt: "select_account"
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;

}

// Exchanges the one-time auth code (from the redirect Google sent the
// browser back to) for an access token, then uses that to fetch the
// signed-in Google account's profile — no client library needed, both are
// plain REST calls.
async function getGoogleProfile(code) {

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: process.env.GOOGLE_REDIRECT_URI,
            grant_type: "authorization_code"
        })
    });

    if (!tokenResponse.ok) {
        throw new Error("Google token exchange failed: " + await tokenResponse.text());
    }

    const tokens = await tokenResponse.json();

    const userResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
    });

    if (!userResponse.ok) {
        throw new Error("Google userinfo fetch failed: " + await userResponse.text());
    }

    return userResponse.json(); // { sub, email, email_verified, given_name, family_name, ... }

}

// The mobile app signs in natively (no redirect/code) and hands us the
// resulting Google ID token directly — tokeninfo both verifies the token's
// signature/expiry and returns its claims in one call. Checking `aud`
// ourselves matters: without it, a valid Google ID token issued to some
// *other* app would also pass verification here.
async function verifyGoogleIdToken(idToken) {

    const response = await fetch(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`);

    if (!response.ok) {
        throw new Error("Invalid Google ID token");
    }

    const claims = await response.json();

    const allowedAudiences = [
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_IOS_CLIENT_ID,
        process.env.GOOGLE_ANDROID_CLIENT_ID
    ].filter(Boolean);

    if (!allowedAudiences.includes(claims.aud)) {
        throw new Error("Google ID token was not issued for this app");
    }

    return claims; // { sub, email, email_verified, given_name, family_name, ... }

}

// Shared by both the website's redirect-based flow and the mobile app's
// native-sign-in flow: given a verified Google profile, finds the matching
// account (by google_id, then falls back to linking an existing account with
// the same email — Google already verified that email belongs to whoever is
// signing in), or creates a new one.
async function findOrCreateGoogleUser(pool, profile) {

    let result = await pool.query(
        "SELECT * FROM users WHERE google_id = $1",
        [profile.sub]
    );

    if (result.rows.length > 0) {
        return result.rows[0];
    }

    const existingByEmail = await pool.query(
        "SELECT * FROM users WHERE email = $1",
        [profile.email]
    );

    if (existingByEmail.rows.length > 0) {

        result = await pool.query(
            `
            UPDATE users
            SET google_id = $1, email_verified = TRUE
            WHERE id = $2
            RETURNING *
            `,
            [profile.sub, existingByEmail.rows[0].id]
        );

    } else {

        result = await pool.query(
            `
            INSERT INTO users
            (first_name, last_name, email, password, status, google_id, email_verified)
            VALUES
            ($1, $2, $3, NULL, 'active', $4, TRUE)
            RETURNING *
            `,
            [profile.given_name || "Χρήστης", profile.family_name || "", profile.email, profile.sub]
        );

    }

    return result.rows[0];

}

module.exports = { getGoogleAuthUrl, getGoogleProfile, verifyGoogleIdToken, findOrCreateGoogleUser };
