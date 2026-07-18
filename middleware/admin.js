const pool = require("../db/database");

async function requireAdmin(req, res, next) {

    if (!req.session.user_id) {

        return res.status(401).send("Not logged in");

    }

    try {

        const result = await pool.query(
            `
            SELECT role
            FROM users
            WHERE id=$1
            `,
            [req.session.user_id]
        );

        if (result.rows.length === 0) {

            return res.status(401).send("User not found");

        }

        if (result.rows[0].role !== "admin") {

            return res.status(403).send("Access denied");

        }

        next();

    }
    catch (error) {

        console.log(error);

        res.status(500).send("Authorization error");

    }

}

module.exports = requireAdmin;