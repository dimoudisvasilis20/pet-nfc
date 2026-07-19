const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const pool = require("../db/database");
const requireLogin = require("../middleware/auth");
const { distanceKm } = require("../utils/geo");
const { createNotification } = require("../utils/notify");

const router = express.Router();

const photoStorage = multer.diskStorage({
    destination: path.join(__dirname, "..", "public", "uploads", "pets"),
    filename: (req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${path.extname(file.originalname)}`);
    }
});

const uploadPhoto = multer({
    storage: photoStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        cb(null, file.mimetype.startsWith("image/"));
    }
});

// The mobile app's photo upload goes through expo-file-system's native
// File.upload() (see AGENTS.md / mobile app notes) instead of fetch()+FormData,
// because RN's FormData bridge can't carry a file part there. That native
// upload uses its own fresh OkHttp client with an empty cookie jar, so the
// express-session cookie never reaches this endpoint. Short-lived, single-use
// upload tokens (issued to an already-authenticated session) stand in for the
// cookie on just this one request.
const uploadTokens = new Map();
const UPLOAD_TOKEN_TTL_MS = 60 * 1000;

function issueUploadToken(userId) {

    const token = crypto.randomBytes(24).toString("hex");
    uploadTokens.set(token, { userId, expiresAt: Date.now() + UPLOAD_TOKEN_TTL_MS });
    return token;

}

function requireLoginOrUploadToken(req, res, next) {

    if (req.session.user_id) {

        req.uploadUserId = req.session.user_id;
        return next();

    }

    const token = req.headers["x-upload-token"];
    const entry = token && uploadTokens.get(token);

    uploadTokens.delete(token);

    if (!entry || entry.expiresAt < Date.now()) {

        return res.status(401).json({ message: "Not logged in" });

    }

    req.uploadUserId = entry.userId;
    next();

}

/*
========================================
CREATE PET
========================================
*/

router.post("/pets", requireLogin, uploadPhoto.single("photo"), async (req, res) => {

    const {
        name,
        species,
        breed,
        gender,
        birth_date,
        weight,
        color,
        microchip,
        medical_notes,
        vet_name,
        vet_phone
    } = req.body;

    const photo = req.file
        ? `/uploads/pets/${req.file.filename}`
        : null;

    const safeBirthDate = birth_date || null;
    const safeWeight = weight === "" || weight === undefined ? null : weight;

    try {

        const result = await pool.query(
            `
            INSERT INTO pets
            (
                user_id,
                name,
                species,
                breed,
                gender,
                birth_date,
                weight,
                color,
                microchip,
                medical_notes,
                vet_name,
                vet_phone,
                photo
            )
            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
            )
            RETURNING *
            `,
            [
                req.session.user_id,
                name,
                species,
                breed,
                gender,
                safeBirthDate,
                safeWeight,
                color,
                microchip,
                medical_notes,
                vet_name,
                vet_phone,
                photo
            ]
        );

        res.json({
            message: "Pet created",
            pet: result.rows[0]
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Pet creation error");

    }

});

/*
========================================
GET USER PETS
========================================
*/

router.get("/pets", requireLogin, async (req, res) => {

    try {

        const result = await pool.query(
            `
            SELECT
                pets.*,
                tags.public_code,
                tags.serial_number,
                tags.status AS tag_status
            FROM pets
            LEFT JOIN tags
            ON pets.id = tags.pet_id
            WHERE pets.user_id = $1
            ORDER BY pets.id DESC
            `,
            [req.session.user_id]
        );

        res.json(result.rows);

    } catch (error) {

        console.log(error);
        res.status(500).send("Pets error");

    }

});

/*
========================================
UPLOAD TOKEN (see requireLoginOrUploadToken above)
========================================
*/

router.get("/pets/upload-token", requireLogin, (req, res) => {

    res.json({ token: issueUploadToken(req.session.user_id) });

});

/*
========================================
GET SINGLE PET
========================================
*/

router.get("/pets/:id", requireLogin, async (req, res) => {

    try {

        const result = await pool.query(
            `
            SELECT
                pets.*,
                tags.public_code,
                tags.serial_number,
                tags.status AS tag_status
            FROM pets
            LEFT JOIN tags
            ON pets.id = tags.pet_id
            WHERE pets.id = $1
            AND pets.user_id = $2
            `,
            [
                req.params.id,
                req.session.user_id
            ]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        res.json(result.rows[0]);

    } catch (error) {

        console.log(error);
        res.status(500).send("Pet error");

    }

});

/*
========================================
UPDATE PET
========================================
*/

router.put("/pets/:id", requireLogin, uploadPhoto.single("photo"), async (req, res) => {

    const {
        name,
        species,
        breed,
        gender,
        birth_date,
        weight,
        color,
        microchip,
        medical_notes,
        vet_name,
        vet_phone
    } = req.body;

    const safeBirthDate = birth_date || null;
    const safeWeight = weight === "" || weight === undefined ? null : weight;

    try {

        const existing = await pool.query(
            "SELECT * FROM pets WHERE id=$1 AND user_id=$2",
            [req.params.id, req.session.user_id]
        );

        if (existing.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        const current = existing.rows[0];

        const detailsChanged =
            (name || "") !== (current.name || "") ||
            (species || "") !== (current.species || "") ||
            (breed || "") !== (current.breed || "") ||
            (gender || "") !== (current.gender || "") ||
            (safeBirthDate || null) !== (current.birth_date || null) ||
            Number(safeWeight || 0) !== Number(current.weight || 0) ||
            (color || "") !== (current.color || "") ||
            (microchip || "") !== (current.microchip || "") ||
            (medical_notes || "") !== (current.medical_notes || "") ||
            (vet_name || "") !== (current.vet_name || "") ||
            (vet_phone || "") !== (current.vet_phone || "");

        if (detailsChanged && current.details_updated_at) {

            const nextAllowed = new Date(current.details_updated_at);
            nextAllowed.setMonth(nextAllowed.getMonth() + 6);

            if (nextAllowed > new Date()) {

                return res.status(403).send(
                    `Τα στοιχεία του κατοικιδίου μπορούν να αλλάξουν μία φορά κάθε 6 μήνες. ` +
                    `Επόμενη διαθέσιμη επεξεργασία: ${nextAllowed.toLocaleDateString("el-GR")}`
                );

            }

        }

        const oldPhoto = current.photo;
        const photo = req.file
            ? `/uploads/pets/${req.file.filename}`
            : oldPhoto;

        const result = await pool.query(
            `
            UPDATE pets
            SET
                name=$1,
                species=$2,
                breed=$3,
                gender=$4,
                birth_date=$5,
                weight=$6,
                color=$7,
                microchip=$8,
                medical_notes=$9,
                vet_name=$10,
                vet_phone=$11,
                photo=$12,
                updated_at=NOW(),
                details_updated_at=CASE WHEN $15 THEN NOW() ELSE details_updated_at END
            WHERE id=$13
            AND user_id=$14
            RETURNING *
            `,
            [
                name,
                species,
                breed,
                gender,
                safeBirthDate,
                safeWeight,
                color,
                microchip,
                medical_notes,
                vet_name,
                vet_phone,
                photo,
                req.params.id,
                req.session.user_id,
                detailsChanged
            ]
        );

        if (req.file && oldPhoto) {

            fs.unlink(
                path.join(__dirname, "..", "public", oldPhoto),
                () => {}
            );

        }

        res.json({
            message: "Pet updated",
            pet: result.rows[0]
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Update error");

    }

});

/*
========================================
UPDATE PET PHOTO
========================================
*/

router.post("/pets/:id/photo", requireLoginOrUploadToken, uploadPhoto.single("photo"), async (req, res) => {

    if (!req.file) {

        return res.status(400).send("No photo uploaded");

    }

    try {

        const existing = await pool.query(
            "SELECT photo FROM pets WHERE id=$1 AND user_id=$2",
            [req.params.id, req.uploadUserId]
        );

        if (existing.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        const oldPhoto = existing.rows[0].photo;
        const photo = `/uploads/pets/${req.file.filename}`;

        const result = await pool.query(
            "UPDATE pets SET photo=$1 WHERE id=$2 AND user_id=$3 RETURNING *",
            [photo, req.params.id, req.uploadUserId]
        );

        if (oldPhoto) {

            fs.unlink(
                path.join(__dirname, "..", "public", oldPhoto),
                () => {}
            );

        }

        res.json({
            message: "Photo updated",
            pet: result.rows[0]
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Photo upload error");

    }

});

/*
========================================
DELETE PET
========================================
*/

router.delete("/pets/:id", requireLogin, async (req, res) => {

    try {

        const result = await pool.query(
            `
            DELETE FROM pets
            WHERE id = $1
            AND user_id = $2
            RETURNING photo
            `,
            [
                req.params.id,
                req.session.user_id
            ]
        );

        if (result.rows.length > 0 && result.rows[0].photo) {

            fs.unlink(
                path.join(__dirname, "..", "public", result.rows[0].photo),
                () => {}
            );

        }

        res.json({
            message: "Pet deleted"
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Delete error");

    }

});

/*
========================================
TRANSFER PET (AND ITS TAG) TO ANOTHER USER
Looks up the target user by email and moves
ownership of the pet (and therefore its NFC tag)
to that account.
========================================
*/

router.put("/pets/:id/transfer", requireLogin, async (req, res) => {

    const { email } = req.body;

    if (!email) {

        return res.status(400).send("Το email του νέου ιδιοκτήτη είναι υποχρεωτικό");

    }

    try {

        const targetUser = await pool.query(
            "SELECT id FROM users WHERE email=$1",
            [email]
        );

        if (targetUser.rows.length === 0) {

            return res.status(404).send("Δεν βρέθηκε χρήστης με αυτό το email");

        }

        const targetUserId = targetUser.rows[0].id;

        if (String(targetUserId) === String(req.session.user_id)) {

            return res.status(400).send("Το κατοικίδιο ανήκει ήδη σε εσένα");

        }

        const result = await pool.query(
            `
            UPDATE pets
            SET user_id=$1,
                updated_at=NOW()
            WHERE id=$2
            AND user_id=$3
            RETURNING *
            `,
            [targetUserId, req.params.id, req.session.user_id]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        res.json({
            message: "Pet transferred",
            pet: result.rows[0]
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Transfer error");

    }

});

/*
========================================
MARK PET AS LOST
Captures where it was last seen and notifies
every opted-in user within THEIR chosen radius.
========================================
*/

router.post("/pets/:id/lost", requireLogin, async (req, res) => {

    const { lat, lng } = req.body;

    if (typeof lat !== "number" || typeof lng !== "number") {

        return res.status(400).send("lat and lng (numbers) are required");

    }

    try {

        const petResult = await pool.query(
            `
            UPDATE pets
            SET is_lost = TRUE,
                lost_at = NOW(),
                last_seen_lat = $1,
                last_seen_lng = $2
            WHERE id = $3
            AND user_id = $4
            RETURNING *
            `,
            [lat, lng, req.params.id, req.session.user_id]
        );

        if (petResult.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        const pet = petResult.rows[0];

        const nearbyUsers = await pool.query(
            `
            SELECT user_id, lat, lng, alert_radius_km
            FROM user_locations
            WHERE user_id != $1
            `,
            [req.session.user_id]
        );

        const toNotify = nearbyUsers.rows.filter(
            (u) => distanceKm(lat, lng, u.lat, u.lng) <= u.alert_radius_km
        );

        for (const u of toNotify) {

            await createNotification(
                u.user_id,
                "Χαμένο κατοικίδιο κοντά σου",
                `Το ${pet.name} (${pet.species || "κατοικίδιο"}) χάθηκε κοντά στην περιοχή σου. Δες τη σελίδα "Χαμένα κατοικίδια" για λεπτομέρειες.`,
                { type: "lost_nearby" }
            );

        }

        res.json({
            message: "Pet marked as lost",
            pet,
            notified: toNotify.length
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Lost-mode error");

    }

});

/*
========================================
MARK PET AS FOUND
========================================
*/

router.post("/pets/:id/found", requireLogin, async (req, res) => {

    try {

        const result = await pool.query(
            `
            UPDATE pets
            SET is_lost = FALSE,
                lost_at = NULL
            WHERE id = $1
            AND user_id = $2
            RETURNING *
            `,
            [req.params.id, req.session.user_id]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        res.json({
            message: "Pet marked as found",
            pet: result.rows[0]
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Found-mode error");

    }

});

/*
========================================
LOST PETS NEAR A GIVEN POINT
Public - used by the "lost pets near me" page so
anyone (not just the owner) can help look.
========================================
*/

router.get("/pets/lost/nearby", async (req, res) => {

    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radiusKm = parseFloat(req.query.radiusKm) || 10;

    if (Number.isNaN(lat) || Number.isNaN(lng)) {

        return res.status(400).send("lat and lng query params are required");

    }

    try {

        // No owner name/phone here — this is a public, unauthenticated
        // endpoint, and only pet details should be visible to whoever's
        // browsing "lost pets near me". Actual contact with the owner
        // happens by scanning the pet's NFC tag if it's physically found.
        const result = await pool.query(
            `
            SELECT
                pets.id,
                pets.name,
                pets.species,
                pets.breed,
                pets.photo,
                pets.last_seen_lat,
                pets.last_seen_lng,
                pets.lost_at
            FROM pets
            WHERE pets.is_lost = TRUE
            AND pets.last_seen_lat IS NOT NULL
            AND pets.last_seen_lng IS NOT NULL
            `
        );

        const nearby = result.rows
            .map((pet) => ({
                ...pet,
                distance_km: distanceKm(lat, lng, pet.last_seen_lat, pet.last_seen_lng)
            }))
            .filter((pet) => pet.distance_km <= radiusKm)
            .sort((a, b) => a.distance_km - b.distance_km);

        res.json(nearby);

    } catch (error) {

        console.log(error);
        res.status(500).send("Nearby lost pets error");

    }

});

/*
========================================
PAIR AN NFC TAG TO A PET
Registers the pet's tag using whichever identifier
the caller has available:
 - public_code: typed in by hand (website "tag number" field)
 - nfc_uid: read from the physical chip (mobile app tap-to-sync)
Creates the pet's tag row on first pairing, or updates it
on re-pairing (e.g. adding the nfc_uid after typing the code first).
========================================
*/

router.post("/pets/:id/tag", requireLogin, async (req, res) => {

    const { public_code, nfc_uid } = req.body;

    if (!public_code && !nfc_uid) {

        return res.status(400).send("Χρειάζεται είτε ο κωδικός του tag είτε ανάγνωση NFC");

    }

    try {

        const petCheck = await pool.query(
            "SELECT id FROM pets WHERE id=$1 AND user_id=$2",
            [req.params.id, req.session.user_id]
        );

        if (petCheck.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        // Does this exact identifier already belong to a tag on a DIFFERENT pet?
        const conflict = await pool.query(
            `
            SELECT * FROM tags
            WHERE (public_code=$1 OR nfc_uid=$2)
            AND pet_id != $3
            `,
            [public_code || null, nfc_uid || null, req.params.id]
        );

        if (conflict.rows.length > 0) {

            return res.status(409).send("Αυτό το tag είναι ήδη συνδεδεμένο με άλλο κατοικίδιο");

        }

        const existingForPet = await pool.query(
            "SELECT * FROM tags WHERE pet_id=$1",
            [req.params.id]
        );

        let tag;

        if (existingForPet.rows.length > 0) {

            const result = await pool.query(
                `
                UPDATE tags
                SET public_code = COALESCE($1, public_code),
                    nfc_uid = COALESCE($2, nfc_uid),
                    status = 'active',
                    activated_at = COALESCE(activated_at, NOW())
                WHERE pet_id = $3
                RETURNING *
                `,
                [public_code || null, nfc_uid || null, req.params.id]
            );

            tag = result.rows[0];

        } else {

            // If this code belongs to a tag an admin already pre-provisioned
            // (created blank, not yet paired to any pet), claim that row
            // instead of creating a brand-new one.
            const unassigned = await pool.query(
                `
                SELECT * FROM tags
                WHERE (public_code=$1 OR nfc_uid=$2)
                AND pet_id IS NULL
                AND status='unassigned'
                `,
                [public_code || null, nfc_uid || null]
            );

            if (unassigned.rows.length > 0) {

                const result = await pool.query(
                    `
                    UPDATE tags
                    SET pet_id = $1,
                        public_code = COALESCE($2, public_code),
                        nfc_uid = COALESCE($3, nfc_uid),
                        status = 'active',
                        activated_at = COALESCE(activated_at, NOW())
                    WHERE id = $4
                    RETURNING *
                    `,
                    [req.params.id, public_code || null, nfc_uid || null, unassigned.rows[0].id]
                );

                tag = result.rows[0];

            } else {

                const code = public_code || nfc_uid;

                const result = await pool.query(
                    `
                    INSERT INTO tags
                    (serial_number, public_code, nfc_uid, pet_id, status, activated_at)
                    VALUES
                    ($1, $2, $3, $4, 'active', NOW())
                    RETURNING *
                    `,
                    [code, code, nfc_uid || null, req.params.id]
                );

                tag = result.rows[0];

            }

        }

        res.json({
            message: "Το tag συνδέθηκε επιτυχώς",
            tag
        });

    } catch (error) {

        if (error.code === "23505") {

            return res.status(409).send("Αυτό το tag είναι ήδη σε χρήση");

        }

        console.log(error);
        res.status(500).send("Tag pairing error");

    }

});

module.exports = router;