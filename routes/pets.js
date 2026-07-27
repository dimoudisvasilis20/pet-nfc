const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const pool = require("../db/database");
const requireLogin = require("../middleware/auth");
const { distanceKm } = require("../utils/geo");
const { createNotification } = require("../utils/notify");
const { uploadPhoto, deletePhoto } = require("../utils/storage");
const { logError } = require("../utils/errorReporting");
const { getAccessiblePetOwnerId } = require("../utils/petAccess");

const router = express.Router();

// In memory only — the file goes straight to B2 (utils/storage.js) rather
// than this server's own disk, which Render wipes on every restart/idle
// spin-down (pet photos were silently disappearing because of this).
const photoUpload = multer({
    storage: multer.memoryStorage(),
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

router.post("/pets", requireLogin, photoUpload.single("photo"), async (req, res) => {

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
        distinguishing_features,
        vet_name,
        vet_phone
    } = req.body;

    const safeBirthDate = birth_date || null;
    const safeWeight = weight === "" || weight === undefined ? null : weight;

    try {

        const photo = req.file
            ? await uploadPhoto(req.file.buffer, req.file.originalname, req.file.mimetype)
            : null;

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
                distinguishing_features,
                vet_name,
                vet_phone,
                photo
            )
            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
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
                distinguishing_features,
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

        logError(error);
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
                tags.status AS tag_status,
                (pets.user_id != $1) AS is_shared,
                owner.first_name AS owner_first_name,
                owner.last_name AS owner_last_name
            FROM pets
            LEFT JOIN tags
            ON pets.id = tags.pet_id
            JOIN users owner
            ON owner.id = pets.user_id
            WHERE pets.user_id = $1
            OR pets.user_id IN (SELECT owner_id FROM pet_shares WHERE member_id = $1)
            ORDER BY pets.id DESC
            `,
            [req.session.user_id]
        );

        res.json(result.rows);

    } catch (error) {

        logError(error);
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

        const ownerId = await getAccessiblePetOwnerId(req.params.id, req.session.user_id);

        if (!ownerId) {

            return res.status(404).send("Pet not found");

        }

        const result = await pool.query(
            `
            SELECT
                pets.*,
                tags.public_code,
                tags.serial_number,
                tags.status AS tag_status,
                users.phone,
                users.alt_phone
            FROM pets
            LEFT JOIN tags
            ON pets.id = tags.pet_id
            JOIN users
            ON users.id = pets.user_id
            WHERE pets.id = $1
            AND pets.user_id = $2
            `,
            [
                req.params.id,
                ownerId
            ]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        res.json(result.rows[0]);

    } catch (error) {

        logError(error);
        res.status(500).send("Pet error");

    }

});

/*
========================================
UPDATE PET
========================================
*/

router.put("/pets/:id", requireLogin, photoUpload.single("photo"), async (req, res) => {

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
        distinguishing_features,
        vet_name,
        vet_phone
    } = req.body;

    const safeBirthDate = birth_date || null;
    const safeWeight = weight === "" || weight === undefined ? null : weight;

    try {

        const ownerId = await getAccessiblePetOwnerId(req.params.id, req.session.user_id);

        if (!ownerId) {

            return res.status(404).send("Pet not found");

        }

        const existing = await pool.query(
            "SELECT * FROM pets WHERE id=$1 AND user_id=$2",
            [req.params.id, ownerId]
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
            (distinguishing_features || "") !== (current.distinguishing_features || "") ||
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
            ? await uploadPhoto(req.file.buffer, req.file.originalname, req.file.mimetype)
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
                distinguishing_features=$10,
                vet_name=$11,
                vet_phone=$12,
                photo=$13,
                updated_at=NOW(),
                details_updated_at=CASE WHEN $16 THEN NOW() ELSE details_updated_at END
            WHERE id=$14
            AND user_id=$15
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
                distinguishing_features,
                vet_name,
                vet_phone,
                photo,
                req.params.id,
                ownerId,
                detailsChanged
            ]
        );

        if (req.file && oldPhoto) {

            deletePhoto(oldPhoto);

        }

        res.json({
            message: "Pet updated",
            pet: result.rows[0]
        });

    } catch (error) {

        logError(error);
        res.status(500).send("Update error");

    }

});

/*
========================================
UPDATE PET PHOTO
========================================
*/

router.post("/pets/:id/photo", requireLoginOrUploadToken, photoUpload.single("photo"), async (req, res) => {

    if (!req.file) {

        return res.status(400).send("No photo uploaded");

    }

    try {

        const ownerId = await getAccessiblePetOwnerId(req.params.id, req.uploadUserId);

        if (!ownerId) {

            return res.status(404).send("Pet not found");

        }

        const existing = await pool.query(
            "SELECT photo FROM pets WHERE id=$1 AND user_id=$2",
            [req.params.id, ownerId]
        );

        if (existing.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        const oldPhoto = existing.rows[0].photo;
        const photo = await uploadPhoto(req.file.buffer, req.file.originalname, req.file.mimetype);

        const result = await pool.query(
            "UPDATE pets SET photo=$1 WHERE id=$2 AND user_id=$3 RETURNING *",
            [photo, req.params.id, ownerId]
        );

        if (oldPhoto) {

            deletePhoto(oldPhoto);

        }

        res.json({
            message: "Photo updated",
            pet: result.rows[0]
        });

    } catch (error) {

        logError(error);
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

            deletePhoto(result.rows[0].photo);

        }

        res.json({
            message: "Pet deleted"
        });

    } catch (error) {

        logError(error);
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

        logError(error);
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

    // Every field here is optional per the lost-report modal — the owner may
    // not know exactly when/where the pet went missing, or may not want to
    // offer a reward. lat/lng, if given, must be a real pair (one without the
    // other can't be used to compute distances below).
    const { lat, lng, notify_lat, notify_lng, missing_at, reward, last_seen_area } = req.body;

    const hasLat = typeof lat === "number";
    const hasLng = typeof lng === "number";

    if (hasLat !== hasLng) {

        return res.status(400).send("lat and lng must be provided together");

    }

    // notify_lat/lng is a silent, background-only GPS fix the app grabs when
    // the owner skips the visible "declare location" step — never stored or
    // shown as the pet's last-seen location, only used below to still find
    // nearby opted-in users to alert. The declared lat/lng (if given) is the
    // better signal and takes priority.
    const hasNotifyLat = typeof notify_lat === "number";
    const hasNotifyLng = typeof notify_lng === "number";
    const searchLat = hasLat ? lat : (hasNotifyLat ? notify_lat : null);
    const searchLng = hasLng ? lng : (hasNotifyLng ? notify_lng : null);
    const hasSearchPoint = searchLat !== null && searchLng !== null;

    try {

        const ownerId = await getAccessiblePetOwnerId(req.params.id, req.session.user_id);

        if (!ownerId) {

            return res.status(404).send("Pet not found");

        }

        const petResult = await pool.query(
            `
            UPDATE pets
            SET is_lost = TRUE,
                lost_at = COALESCE($1::timestamp, NOW()),
                last_seen_lat = $2,
                last_seen_lng = $3,
                reward = $4,
                last_seen_area = $5
            WHERE id = $6
            AND user_id = $7
            RETURNING *
            `,
            [missing_at || null, hasLat ? lat : null, hasLng ? lng : null, reward || null, last_seen_area || null, req.params.id, ownerId]
        );

        if (petResult.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        const pet = petResult.rows[0];
        let notifiedCount = 0;

        // Nothing to compute distance from if neither a declared nor a
        // silent background location came through at all.
        if (hasSearchPoint) {

            const nearbyUsers = await pool.query(
                `
                SELECT user_id, lat, lng, alert_radius_km
                FROM user_locations
                WHERE user_id != $1
                `,
                [req.session.user_id]
            );

            const toNotify = nearbyUsers.rows.filter(
                (u) => distanceKm(searchLat, searchLng, u.lat, u.lng) <= u.alert_radius_km
            );

            for (const u of toNotify) {

                await createNotification(
                    u.user_id,
                    "Χαμένο κατοικίδιο κοντά σου",
                    `Το ${pet.name} (${pet.species || "κατοικίδιο"}) χάθηκε κοντά στην περιοχή σου. Δες τη σελίδα "Χαμένα κατοικίδια" για λεπτομέρειες.`,
                    { type: "lost_nearby" }
                );

            }

            notifiedCount = toNotify.length;

        }

        res.json({
            message: "Pet marked as lost",
            pet,
            notified: notifiedCount
        });

    } catch (error) {

        logError(error);
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

        const ownerId = await getAccessiblePetOwnerId(req.params.id, req.session.user_id);

        if (!ownerId) {

            return res.status(404).send("Pet not found");

        }

        const result = await pool.query(
            `
            UPDATE pets
            SET is_lost = FALSE,
                lost_at = NULL,
                reward = NULL,
                last_seen_area = NULL
            WHERE id = $1
            AND user_id = $2
            RETURNING *
            `,
            [req.params.id, ownerId]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        res.json({
            message: "Pet marked as found",
            pet: result.rows[0]
        });

    } catch (error) {

        logError(error);
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

        // Cheap square pre-filter (backed by idx_pets_lost_location) so the
        // DB only has to hand back pets in roughly the right area, instead of
        // every lost pet on the planet — the exact circular distance/radius
        // check below still runs on this smaller set, since a bounding box
        // is a superset of the real circle (includes the box's corners).
        // ~111km per degree of latitude; longitude shrinks with cos(lat).
        const latDelta = radiusKm / 111;
        const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);

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
                pets.lost_at,
                pets.reward
            FROM pets
            WHERE pets.is_lost = TRUE
            AND pets.last_seen_lat BETWEEN $1 AND $2
            AND pets.last_seen_lng BETWEEN $3 AND $4
            `,
            [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta]
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

        logError(error);
        res.status(500).send("Nearby lost pets error");

    }

});

/*
========================================
REPORT A SIGHTING OF A LOST PET
A stranger (not the tag holder) saying "I think I saw this pet" from the
"Χαμένα κοντά μου" list/map. Restricted to email-verified accounts and
structured to fixed choices (no free text) — kept simple on purpose,
since an open message field is the easiest way to turn this into a vector
for confusing or harassing the owner. Location is the reporter's own
device GPS at submit time, same pattern as the scan page's "share my
location" — not a typed-in address.
========================================
*/

const SIGHTING_RECENCY = ["just_now", "few_hours_ago", "yesterday_or_earlier"];
const SIGHTING_CONDITION = ["seemed_fine", "seemed_injured", "unknown"];

const RECENCY_LABEL = {
    just_now: "μόλις τώρα",
    few_hours_ago: "πριν λίγες ώρες",
    yesterday_or_earlier: "χθες ή παλιότερα",
};

router.post("/pets/:id/sightings", requireLogin, async (req, res) => {

    const { certainty, recency, condition, lat, lng } = req.body;

    if (certainty !== "sure" && certainty !== "maybe") {

        return res.status(400).send("certainty must be 'sure' or 'maybe'");

    }

    if (!SIGHTING_RECENCY.includes(recency)) {

        return res.status(400).send("recency must be one of: " + SIGHTING_RECENCY.join(", "));

    }

    if (!SIGHTING_CONDITION.includes(condition)) {

        return res.status(400).send("condition must be one of: " + SIGHTING_CONDITION.join(", "));

    }

    try {

        const reporter = await pool.query(
            "SELECT email_verified FROM users WHERE id=$1",
            [req.session.user_id]
        );

        if (!reporter.rows[0]?.email_verified) {

            return res.status(403).send("Χρειάζεται επιβεβαιωμένο email για να κάνεις αναφορά θέασης.");

        }

        const pet = await pool.query(
            "SELECT id, name, user_id, is_lost FROM pets WHERE id=$1",
            [req.params.id]
        );

        if (pet.rows.length === 0) {

            return res.status(404).send("Pet not found");

        }

        if (!pet.rows[0].is_lost) {

            return res.status(400).send("Αυτό το κατοικίδιο δεν είναι δηλωμένο χαμένο.");

        }

        if (pet.rows[0].user_id === req.session.user_id) {

            return res.status(400).send("Δεν μπορείς να αναφέρεις θέαση για το δικό σου κατοικίδιο.");

        }

        await pool.query(
            `
            INSERT INTO pet_sightings
            (pet_id, reporter_user_id, certainty, recency, condition, lat, lng)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            `,
            [req.params.id, req.session.user_id, certainty, recency, condition, lat ?? null, lng ?? null]
        );

        const conditionNote = condition === "seemed_injured"
            ? " Φαινόταν τραυματισμένο/άρρωστο!"
            : "";

        await createNotification(
            pet.rows[0].user_id,
            condition === "seemed_injured" ? "🚨 Αναφορά θέασης" : "👁️ Αναφορά θέασης",
            (certainty === "sure"
                ? `Κάποιος είναι σίγουρος ότι είδε το ${pet.rows[0].name}`
                : `Κάποιος νομίζει ότι είδε το ${pet.rows[0].name}`)
                + ` (${RECENCY_LABEL[recency]}).${conditionNote}`,
            { type: "pet_sighting", petId: pet.rows[0].id, certainty, recency, condition, lat: lat ?? null, lng: lng ?? null }
        );

        res.json({ message: "Sighting reported" });

    } catch (error) {

        logError(error);
        res.status(500).send("Sighting report error");

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

        const ownerId = await getAccessiblePetOwnerId(req.params.id, req.session.user_id);

        if (!ownerId) {

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

        logError(error);
        res.status(500).send("Tag pairing error");

    }

});

module.exports = router;