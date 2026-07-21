const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

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

module.exports = { getGoogleAuthUrl, getGoogleProfile };
