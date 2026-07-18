const express = require("express");
const path = require("path");
const fs = require("fs");
const pool = require("../db/database");
const requireAdmin = require("../middleware/admin");

const router = express.Router();

/*
========================================
ADMIN STATS
========================================
*/

router.get("/admin/stats", requireAdmin, async (req, res) => {

    try {

        const users = await pool.query(
            "SELECT COUNT(*) FROM users"
        );

        const pets = await pool.query(
            "SELECT COUNT(*) FROM pets"
        );

        const tags = await pool.query(
            "SELECT COUNT(*) FROM tags"
        );

        const scans = await pool.query(`
            SELECT COUNT(*)
            FROM scan_history
            WHERE DATE(scanned_at)=CURRENT_DATE
        `);

        res.json({

            users: Number(users.rows[0].count),

            pets: Number(pets.rows[0].count),

            tags: Number(tags.rows[0].count),

            scans: Number(scans.rows[0].count)

        });

    }

    catch(error){

        console.log(error);

        res.status(500).send("Admin stats error");

    }

});

/*
========================================
ALL USERS
========================================
*/

router.get("/admin/users", requireAdmin, async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT

                id,

                first_name,

                last_name,

                email,

                phone,

                role,

                status,

                created_at

            FROM users

            ORDER BY id DESC
        `);

        res.json(result.rows);

    }

    catch(error){

        console.log(error);

        res.status(500).send("Users error");

    }

});

/*
========================================
CHANGE USER ROLE
========================================
*/

router.put("/admin/users/:id/role", requireAdmin, async (req, res) => {

    const { role } = req.body;

    if (role !== "user" && role !== "admin") {

        return res.status(400).send("role must be 'user' or 'admin'");

    }

    if (String(req.params.id) === String(req.session.user_id)) {

        return res.status(400).send("Δεν μπορείς να αλλάξεις τον δικό σου ρόλο");

    }

    try {

        const result = await pool.query(
            `
            UPDATE users
            SET role=$1
            WHERE id=$2
            RETURNING id, first_name, last_name, email, role
            `,
            [role, req.params.id]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("User not found");

        }

        res.json({
            message: "Role updated",
            user: result.rows[0]
        });

    }

    catch(error){

        console.log(error);

        res.status(500).send("Role update error");

    }

});

/*
========================================
DELETE USER (and all their data)
========================================
*/

router.delete("/admin/users/:id", requireAdmin, async (req, res) => {

    if (String(req.params.id) === String(req.session.user_id)) {

        return res.status(400).send("Δεν μπορείς να διαγράψεις τον δικό σου λογαριασμό");

    }

    try {

        // pets/tags/notifications/user_locations/calendar_events/pet_contacts
        // all have ON DELETE CASCADE back to users, so deleting the user row
        // cleans up every related row automatically. Pet photo files on disk
        // aren't tracked by the DB though, so grab those first to unlink
        // once the delete has gone through.
        const photos = await pool.query(
            "SELECT photo FROM pets WHERE user_id=$1 AND photo IS NOT NULL",
            [req.params.id]
        );

        const result = await pool.query(
            "DELETE FROM users WHERE id=$1 RETURNING id",
            [req.params.id]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("User not found");

        }

        photos.rows.forEach((row) => {

            fs.unlink(
                path.join(__dirname, "..", "public", row.photo),
                () => {}
            );

        });

        res.json({
            message: "User deleted"
        });

    }

    catch(error){

        console.log(error);

        res.status(500).send("Delete user error");

    }

});

/*
========================================
ALL PETS
========================================
*/

router.get("/admin/pets", requireAdmin, async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT

                pets.*,

                users.first_name,

                users.last_name

            FROM pets

            JOIN users

            ON pets.user_id = users.id

            ORDER BY pets.id DESC
        `);

        res.json(result.rows);

    }

    catch(error){

        console.log(error);

        res.status(500).send("Pets error");

    }

});

// Tag management (list/create/assign/delete) lives in routes/tags.js —
// GET /tags, POST /tags, PUT /tags/:id/assign, DELETE /tags/:id.

/*
========================================
SCAN HISTORY
========================================
*/

router.get("/admin/scans", requireAdmin, async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT

                scan_history.*,

                pets.name AS pet_name,

                users.first_name,

                users.last_name

            FROM scan_history

            JOIN tags

            ON scan_history.tag_id = tags.id

            JOIN pets

            ON tags.pet_id = pets.id

            JOIN users

            ON pets.user_id = users.id

            ORDER BY scan_history.scanned_at DESC
        `);

        res.json(result.rows);

    }

    catch(error){

        console.log(error);

        res.status(500).send("Scans error");

    }

});

/*
========================================
ALL NOTIFICATIONS
========================================
*/

router.get("/admin/notifications", requireAdmin, async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT

                notifications.*,

                users.first_name,

                users.last_name

            FROM notifications

            JOIN users

            ON notifications.user_id = users.id

            ORDER BY notifications.created_at DESC
        `);

        res.json(result.rows);

    }

    catch(error){

        console.log(error);

        res.status(500).send("Notifications error");

    }

});

module.exports = router;