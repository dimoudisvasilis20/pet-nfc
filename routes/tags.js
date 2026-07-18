const express = require("express");
const pool = require("../db/database");
const requireAdmin = require("../middleware/admin");
const { generatePublicCode, generateSerialNumber } = require("../utils/tagCode");

const router = express.Router();

/*
========================================
GET ALL TAGS (admin)
========================================
*/

router.get("/tags", requireAdmin, async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                tags.*,
                pets.name AS pet_name,
                users.first_name,
                users.last_name
            FROM tags
            LEFT JOIN pets
            ON tags.pet_id = pets.id
            LEFT JOIN users
            ON pets.user_id = users.id
            ORDER BY tags.id DESC
        `);

        res.json(result.rows);

    } catch (error) {

        console.log(error);
        res.status(500).send("Tags error");

    }

});

/*
========================================
GET SINGLE TAG (admin)
========================================
*/

router.get("/tags/:id", requireAdmin, async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT *
            FROM tags
            WHERE id=$1
        `,
        [req.params.id]);

        if (result.rows.length === 0) {

            return res.status(404).send("Tag not found");

        }

        res.json(result.rows[0]);

    } catch (error) {

        console.log(error);
        res.status(500).send("Tag error");

    }

});

/*
========================================
GENERATE BLANK TAGS (admin)
========================================
*/

router.post("/tags", requireAdmin, async (req, res) => {

    const quantity = Math.min(Math.max(parseInt(req.body.quantity, 10) || 1, 1), 100);
    const created = [];

    try {

        for (let i = 0; i < quantity; i++) {

            let tag = null;

            // public_code/serial_number are randomly generated, so a collision
            // with an existing one is possible (if rare) — retry on conflict.
            for (let attempt = 0; attempt < 5 && !tag; attempt++) {

                try {

                    const result = await pool.query(
                        `
                        INSERT INTO tags (serial_number, public_code, status)
                        VALUES ($1, $2, 'unassigned')
                        RETURNING *
                        `,
                        [generateSerialNumber(), generatePublicCode()]
                    );

                    tag = result.rows[0];

                } catch (error) {

                    if (error.code !== "23505") throw error;

                }

            }

            if (!tag) {

                throw new Error("Could not generate a unique tag code after 5 attempts");

            }

            created.push(tag);

        }

        res.json({
            message: "Tags created",
            tags: created
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Create tag error");

    }

});

/*
========================================
ASSIGN TAG TO A PET (admin)
========================================
*/

router.put("/tags/:id/assign", requireAdmin, async (req, res) => {

    const { pet_id } = req.body;

    if (!pet_id) {

        return res.status(400).send("pet_id is required");

    }

    try {

        const pet = await pool.query("SELECT id FROM pets WHERE id=$1", [pet_id]);

        if (pet.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        // A tag can only ever be assigned once — once it's attached to a pet,
        // it stays attached to that pet even if the pet changes owners (see
        // PUT /pets/:id/transfer, which only updates the pet's user_id and
        // deliberately leaves the tag row untouched). Re-pointing an
        // already-assigned tag at a different pet here would let the same
        // physical tag be "reused", which is exactly what's disallowed.
        const result = await pool.query(
            `
            UPDATE tags
            SET pet_id=$1, status='active', activated_at=COALESCE(activated_at, NOW())
            WHERE id=$2 AND status='unassigned'
            RETURNING *
            `,
            [pet_id, req.params.id]
        );

        if (result.rows.length === 0) {

            const existing = await pool.query("SELECT id FROM tags WHERE id=$1", [req.params.id]);

            if (existing.rows.length === 0) {

                return res.status(404).send("Tag not found");

            }

            return res.status(409).send("Αυτό το tag έχει ήδη χρησιμοποιηθεί — κάθε tag μπορεί να ανατεθεί μόνο μία φορά.");

        }

        res.json({
            message: "Tag assigned",
            tag: result.rows[0]
        });

    } catch (error) {

        console.log(error);

        if (error.code === "23505") {

            return res.status(409).send("That pet already has a different tag, or this tag's code conflicts with another.");

        }

        res.status(500).send("Assign error");

    }

});

/*
========================================
DELETE TAG (admin)
========================================
*/

// Deletes a tag regardless of status — including one already paired to a
// pet, which unlinks it in the same action (scan_history rows for it are
// removed too via ON DELETE CASCADE). Needed e.g. when a tag was created in
// error (duplicate/misread) or a physical tag is lost/broken.
router.delete("/tags/:id", requireAdmin, async (req, res) => {

    try {

        const result = await pool.query(
            `
            DELETE FROM tags
            WHERE id=$1
            RETURNING id
            `,
            [req.params.id]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("Tag not found");

        }

        res.json({
            message: "Tag deleted"
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Delete error");

    }

});

module.exports = router;
