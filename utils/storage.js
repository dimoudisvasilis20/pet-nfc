const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const path = require("path");

// Backblaze B2's S3-compatible API lets us use the standard AWS SDK instead
// of a separate client library — just point it at B2's endpoint.
// Constructed lazily (like Resend in utils/email.js) so a missing/blank
// B2_ENDPOINT in local dev doesn't crash the server at require-time.
let client = null;

function getClient() {

    if (!client) {

        client = new S3Client({
            region: "auto",
            endpoint: process.env.B2_ENDPOINT,
            credentials: {
                accessKeyId: process.env.B2_ACCESS_KEY_ID,
                secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
            },
        });

    }

    return client;

}

// The bucket is kept Private (Backblaze wants card verification before
// allowing a Public bucket) — photos are served back out through our own
// /photo/:key route (see routes/public.js) instead of a direct bucket URL,
// so no public-bucket access is needed at all.
//
// Pet photos used to live on the web service's own disk, which Render wipes
// on every restart/idle-spin-down — uploaded photos would silently vanish.
// B2 is real persistent storage, independent of which server instance (or
// region) happens to be running.
async function uploadPhoto(buffer, originalName, mimetype) {

    if (!process.env.B2_ENDPOINT) {
        throw new Error("B2_ENDPOINT is not set");
    }

    // No "/" in the key — it becomes a single URL path segment in /photo/:key.
    const key = `${Date.now()}-${crypto.randomBytes(9).toString("hex")}${path.extname(originalName)}`;

    await getClient().send(new PutObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
    }));

    return `/photo/${key}`;

}

// Only ever called with a URL this same bucket produced (see uploadPhoto
// above) — old pre-migration photo paths look like "/uploads/pets/..." and
// are filtered out by callers before this is reached, so failures here are
// unexpected rather than routine and are left to just log.
async function deletePhoto(photoUrl) {

    if (!photoUrl || !photoUrl.startsWith("/photo/")) {
        return;
    }

    const key = photoUrl.slice("/photo/".length);

    try {

        await getClient().send(new DeleteObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: key,
        }));

    } catch (error) {

        console.log("❌ B2 delete error:", error.message);

    }

}

// Used by the public /photo/:key route to stream a stored photo back out —
// needs our own credentials since the bucket itself is private.
async function getPhotoObject(key) {

    return getClient().send(new GetObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key,
    }));

}

module.exports = { uploadPhoto, deletePhoto, getPhotoObject };
