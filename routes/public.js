const express = require("express");
const pool = require("../db/database");
const { createNotification } = require("../utils/notify");
const { getPhotoObject } = require("../utils/storage");

const router = express.Router();

/*
========================================
PET PHOTO (proxied from B2 — the bucket is private, so this is the only
way to actually view a photo; see utils/storage.js)
========================================
*/

router.get("/photo/:key", async (req, res) => {

    try {

        const object = await getPhotoObject(req.params.key);

        res.set("Content-Type", object.ContentType || "image/jpeg");
        res.set("Cache-Control", "public, max-age=31536000, immutable");
        object.Body.pipe(res);

    } catch (error) {

        res.status(404).send("Photo not found");

    }

});

/*
========================================
PUBLIC NFC PAGE
========================================
*/

router.get("/p/:code", async (req, res) => {

    const code = req.params.code;

    try {

        const result = await pool.query(
        `
        SELECT

            tags.id AS tag_id,

            pets.id AS pet_id,
            pets.name AS pet_name,
            pets.breed,
            pets.photo,
            pets.medical_notes,
            pets.is_lost,
            pets.reward,
            pets.lost_at,
            pets.last_seen_lat,
            pets.last_seen_lng,

            users.id AS user_id,
            users.first_name,
            users.last_name,
            users.phone,
            users.alt_phone

        FROM tags

        JOIN pets
            ON tags.pet_id = pets.id

        JOIN users
            ON pets.user_id = users.id

        WHERE tags.public_code = $1
        `,
        [code]);

        if(result.rows.length === 0){

            return res.send("Δεν βρέθηκε κατοικίδιο");

        }

        const pet = result.rows[0];

        /*
        ========================
        SAVE SCAN
        ========================
        */

        await pool.query(
        `
        INSERT INTO scan_history
        (
            tag_id,
            device,
            browser
        )
        VALUES
        (
            $1,
            $2,
            $3
        )
        `,
        [
            pet.tag_id,
            req.headers["user-agent"],
            req.headers["user-agent"]
        ]);

        /*
        ========================
        CREATE NOTIFICATION
        ========================
        */

        await createNotification(
            pet.user_id,
            "Νέα σάρωση NFC",
            `Κάποιος σκάναρε το tag του ${pet.pet_name}`,
            { type: "nfc_scan", petId: pet.pet_id }
        );

        /*
        ========================
        PUBLIC PAGE
        ========================
        */

        res.send(buildScanPage(pet, code));

    }
    catch(error){

        console.log(error);

        res.status(500)
        .send("Database error");

    }

});

/*
========================================
SHARE SCANNER'S LOCATION WITH THE OWNER
(unauthenticated — the scanner is whoever
found the pet, not a logged-in user)
========================================
*/

router.post("/p/:code/share-location", async (req, res) => {

    const code = req.params.code;
    const { lat, lng } = req.body;

    if (typeof lat !== "number" || typeof lng !== "number") {

        return res.status(400).send("lat and lng (numbers) are required");

    }

    try {

        const result = await pool.query(
            `
            SELECT pets.id AS pet_id, pets.name AS pet_name, users.id AS user_id
            FROM tags
            JOIN pets ON tags.pet_id = pets.id
            JOIN users ON pets.user_id = users.id
            WHERE tags.public_code = $1
            `,
            [code]
        );

        if (result.rows.length === 0) {

            return res.status(404).send("Δεν βρέθηκε κατοικίδιο");

        }

        const pet = result.rows[0];

        await createNotification(
            pet.user_id,
            "📍 Κάποιος μοιράστηκε την τοποθεσία του",
            `Κάποιος που σκάναρε το tag του ${pet.pet_name} μοιράστηκε την τοποθεσία του μαζί σου.`,
            { type: "location_shared", petId: pet.pet_id, lat, lng }
        );

        res.json({ message: "Location shared" });

    } catch (error) {

        console.log(error);
        res.status(500).send("Share location error");

    }

});

function buildScanPage(pet, code) {

    const lostAtText = pet.lost_at
        ? new Date(pet.lost_at).toLocaleString("el-GR", { dateStyle: "medium", timeStyle: "short" })
        : null;

    const hasLastSeenLocation = pet.last_seen_lat != null && pet.last_seen_lng != null;
    const mapsUrl = hasLastSeenLocation
        ? `https://www.google.com/maps?q=${pet.last_seen_lat},${pet.last_seen_lng}`
        : null;

    return `
<!DOCTYPE html>

<html lang="el">

<head>

<meta charset="UTF-8">

<meta name="viewport"
content="width=device-width, initial-scale=1">

<title>${pet.pet_name}</title>

<link rel="icon" type="image/svg+xml" href="/favicon.svg">

<link rel="stylesheet" href="/css/style.css">

<style>

body{

display:flex;
align-items:center;
justify-content:center;
min-height:100vh;
padding:20px;

}

.scan-card{

max-width:440px;
width:100%;

text-align:center;

}

.scan-card h1{

font-size:30px;
margin-bottom:6px;

}

.pet{

font-size:18px;
color:var(--color-text-muted);

}

.scan-photo{

width:140px;
height:140px;
border-radius:50%;
object-fit:cover;
margin:0 auto 16px;
display:block;
border:3px solid var(--color-border);

}

.scan-photo-placeholder{

width:140px;
height:140px;
border-radius:50%;
margin:0 auto 16px;
display:flex;
align-items:center;
justify-content:center;
font-size:56px;
background:linear-gradient(135deg,var(--color-primary-light),#e0e7ff);
border:3px solid var(--color-border);

}

.info{

margin-top:20px;

padding:16px 18px;

background:var(--color-warning-bg);

border-radius:var(--radius-sm);

text-align:left;

}

.info h3{

font-size:14px;

}

.scan-card.lost{

border:2px solid var(--color-danger);
background:var(--color-danger-light);

}

.lost-banner{

margin-bottom:16px;

padding:12px 16px;

background:var(--color-danger);
color:#fff;

border-radius:var(--radius-sm);

font-weight:700;

}

.lost-banner .reward{

margin-top:4px;
font-weight:600;
font-size:14px;

}

.lost-banner .lost-meta{

margin-top:4px;
font-weight:500;
font-size:14px;

}

.lost-banner .lost-meta a{

color:#fff;
text-decoration:underline;

}

.alt-phone{

margin-top:10px;
font-size:13px;
color:var(--color-text-muted);

}

</style>

</head>

<body>

<div class="card scan-card${pet.is_lost ? " lost" : ""}">

${pet.is_lost ? `
<div class="lost-banner">
🚨 ΧΑΜΕΝΟ — βοηθήστε το να γυρίσει σπίτι
${lostAtText ? `<div class="lost-meta">🕒 Εξαφανίστηκε: ${lostAtText}</div>` : ""}
${hasLastSeenLocation ? `<div class="lost-meta">📍 <a href="${mapsUrl}" target="_blank" rel="noopener">Τελευταία γνωστή τοποθεσία</a></div>` : ""}
${pet.reward ? `<div class="reward">🎁 Αμοιβή: ${pet.reward}</div>` : ""}
</div>
` : ""}

${pet.photo ? `<img class="scan-photo" src="${pet.photo}" alt="${pet.pet_name}">` : `<div class="scan-photo-placeholder">🐾</div>`}

<h1>🐾 ${pet.pet_name}</h1>

<div class="pet">

${pet.breed}

</div>

<p>

Το κατοικίδιο βρέθηκε.

</p>

<div class="info">

<h3>Ιατρικές πληροφορίες</h3>

<p>

${pet.medical_notes || "Δεν υπάρχουν καταχωρημένες πληροφορίες."}

</p>

</div>

<a
class="btn btn-success"
href="tel:${pet.phone}">

📞 Κλήση ιδιοκτήτη

</a>

${pet.alt_phone ? `
<a
class="btn btn-outline"
style="margin-top:10px;width:100%;"
href="tel:${pet.alt_phone}">

📞 Δεύτερο τηλέφωνο (αν δεν απαντήσει το πρώτο)

</a>
` : ""}

<button
type="button"
id="share-location-btn"
class="btn btn-outline"
style="margin-top:10px;width:100%;"
onclick="shareLocation()">

📍 Κοινοποίηση της τρέχουσας τοποθεσίας

</button>

<p id="share-location-status" style="margin-top:10px;font-size:13px;color:var(--color-text-muted);"></p>

</div>

<script>

function shareLocation(){

    const statusEl = document.getElementById("share-location-status");
    const btn = document.getElementById("share-location-btn");

    if(!navigator.geolocation){
        statusEl.textContent = "Η συσκευή σου δεν υποστηρίζει κοινοποίηση τοποθεσίας.";
        return;
    }

    btn.disabled = true;
    statusEl.textContent = "Λήψη τοποθεσίας...";

    navigator.geolocation.getCurrentPosition(
        async (position) => {

            try {

                const response = await fetch("/p/${code}/share-location", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    })
                });

                if(response.ok){
                    statusEl.textContent = "✅ Η τοποθεσία σου στάλθηκε στον ιδιοκτήτη.";
                } else {
                    statusEl.textContent = "Κάτι πήγε στραβά. Δοκίμασε ξανά.";
                    btn.disabled = false;
                }

            } catch(e){
                statusEl.textContent = "Κάτι πήγε στραβά. Δοκίμασε ξανά.";
                btn.disabled = false;
            }

        },
        () => {
            statusEl.textContent = "Δεν δόθηκε πρόσβαση στην τοποθεσία σου.";
            btn.disabled = false;
        }
    );

}

</script>

</body>

</html>
`;

}

module.exports = router;