const pool = require("../db/database");

// Family/co-owner access: a "family member" (see routes/account.js /me/family)
// has the exact same rights as the real owner over every one of the owner's
// pets. Resolves to the pet's real user_id — the id every pets/calendar
// query is actually scoped by — if callerId is either that owner or a member
// they've added, otherwise null (caller has no access at all).
async function getAccessiblePetOwnerId(petId, callerId) {

    const result = await pool.query(
        `
        SELECT user_id FROM pets
        WHERE id = $1
        AND (
            user_id = $2
            OR user_id IN (SELECT owner_id FROM pet_shares WHERE member_id = $2)
        )
        `,
        [petId, callerId]
    );

    return result.rows.length > 0 ? result.rows[0].user_id : null;

}

module.exports = { getAccessiblePetOwnerId };
