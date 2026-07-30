const { z } = require("zod");

// Wraps a Zod schema as Express middleware — validates req.body, replaces it
// with the parsed (trimmed/coerced) result so routes only ever see clean
// data, and short-circuits with 400 + the first error message on failure.
// Keeps every route's own code free of hand-rolled "if (!field)" checks.
function validateBody(schema) {

    return (req, res, next) => {

        const result = schema.safeParse(req.body);

        if (!result.success) {

            return res.status(400).json({
                message: result.error.issues[0]?.message || "Μη έγκυρα δεδομένα"
            });

        }

        req.body = result.data;
        next();

    };

}

// Same idea for a small number of well-known fields that arrive as query
// strings, e.g. GET /verify-email?token=...
function validateQuery(schema) {

    return (req, res, next) => {

        const result = schema.safeParse(req.query);

        if (!result.success) {

            return res.status(400).json({
                message: result.error.issues[0]?.message || "Μη έγκυρα δεδομένα"
            });

        }

        req.query = result.data;
        next();

    };

}

// Shared building blocks so every route describes the same field the same
// way instead of re-inventing "what counts as a valid email" five times.
const schemas = {

    email: z.string().trim().toLowerCase().email("Μη έγκυρο email").max(254),

    // Bcrypt silently truncates input past 72 bytes — capping here means the
    // stored hash actually covers the whole password the user typed.
    password: z.string().min(8, "Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες").max(72),

    name: z.string().trim().min(1, "Υποχρεωτικό πεδίο").max(100),

    // Loose on purpose — phone formats vary a lot (spaces, +30, etc.); this
    // just bounds length and blocks obviously-wrong input (letters, scripts).
    phone: z.string().trim().regex(/^[0-9+()\-\s]{6,30}$/, "Μη έγκυρος αριθμός τηλεφώνου"),

    latitude: z.number().min(-90).max(90),

    longitude: z.number().min(-180).max(180),

};

module.exports = { validateBody, validateQuery, schemas, z };
