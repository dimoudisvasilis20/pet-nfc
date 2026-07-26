// Single choke point for reporting caught errors, so every route's catch
// block feeds both the console (always) and Sentry (only when configured) —
// without this, only uncaught crashes reach Sentry, missing the vast
// majority of real errors that routes already catch and handle gracefully.
const Sentry = process.env.SENTRY_DSN ? require("@sentry/node") : null;

function logError(error) {

    console.log(error);

    if (Sentry) {
        Sentry.captureException(error);
    }

}

module.exports = { logError };
