const express = require("express");
const pool = require("../db/database");
const { createNotification } = require("../utils/notify");

const router = express.Router();

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

            users.id AS user_id,
            users.first_name,
            users.last_name,
            users.phone

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

</style>

</head>

<body>

<div class="card scan-card">

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

<button
type="button"
id="share-location-btn"
class="btn btn-outline"
style="margin-top:10px;width:100%;"
onclick="shareLocation()">

📍 Κοινοποίηση της τοποθεσίας μου

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