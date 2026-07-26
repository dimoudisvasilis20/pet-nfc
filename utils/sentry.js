// Reads recent issues from the Sentry project every route's caught errors
// now report to (see utils/errorReporting.js). Org/project slugs aren't
// secret and rarely change, so they're hardcoded here — only the auth token
// is a credential, kept in SENTRY_AUTH_TOKEN.
//
// This project's Sentry org lives in the EU data region, whose API is
// served from a different host (de.sentry.io) than the global one
// (sentry.io) — using the wrong host 401s even with a valid token.
const SENTRY_API_BASE = "https://de.sentry.io/api/0";
const SENTRY_ORG = "pawtrace";
const SENTRY_PROJECT = "node";

// Returns null when no token is configured (caller should treat that as
// "not set up yet", distinct from "configured but zero issues").
async function getRecentIssues() {

    if (!process.env.SENTRY_AUTH_TOKEN) {
        return null;
    }

    const response = await fetch(
        `${SENTRY_API_BASE}/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?statsPeriod=14d&query=`,
        { headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` } }
    );

    if (!response.ok) {
        throw new Error(`Sentry API error: ${response.status}`);
    }

    const issues = await response.json();

    return issues.map((issue) => ({
        id: issue.id,
        title: issue.title,
        culprit: issue.culprit,
        level: issue.level,
        status: issue.status,
        count: issue.count,
        userCount: issue.userCount,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
        permalink: issue.permalink,
    }));

}

module.exports = { getRecentIssues };
