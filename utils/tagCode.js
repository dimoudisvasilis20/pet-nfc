const crypto = require("crypto");

// Avoids visually ambiguous characters (0/O, 1/I/L) since public_code is
// meant to be readable/typeable by hand as a fallback to scanning the tag.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generatePublicCode() {

    let code = "";

    for (let i = 0; i < 8; i++) {

        code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];

    }

    return code;

}

function generateSerialNumber() {

    return crypto.randomBytes(8).toString("hex").toUpperCase();

}

module.exports = { generatePublicCode, generateSerialNumber };
