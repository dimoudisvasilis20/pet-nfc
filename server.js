require("dotenv").config({ quiet: true }); // suppresses dotenv's promotional console "tips"

const express = require("express");
const cors = require("cors");
const session = require("express-session");

const authRoutes = require("./routes/auth");
const petRoutes = require("./routes/pets");
const tagRoutes = require("./routes/tags");
const dashboardRoutes = require("./routes/dashboard");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");
const publicRoutes = require("./routes/public");
const locationRoutes = require("./routes/location");
const scanRoutes = require("./routes/scans");
const accountRoutes = require("./routes/account");
const calendarRoutes = require("./routes/calendar");

const app = express();

app.use(cors({
    origin: true,      // reflect the request's Origin so credentials (session cookie) are allowed
    credentials: true   // needed by the mobile app (Expo web / native), which calls the API cross-origin
}));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || "pet-nfc-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    }
}));

// Static frontend (login.html, dashboard.html, add-pet.html, lost-pets.html, admin/...)
app.use(express.static("public"));

// API routes
app.use(authRoutes);          // /register, /login
app.use(petRoutes);           // /pets, /pets/:id, /pets/:id/lost, /pets/:id/found, /pets/lost/nearby
app.use(tagRoutes);           // /tags
app.use(dashboardRoutes);     // /dashboard
app.use(notificationRoutes);  // /notifications
app.use(adminRoutes);         // /admin/*
app.use(publicRoutes);        // /p/:code  <- what the NFC tag URL opens, no login needed
app.use(locationRoutes);      // /me/location  <- opt in to lost-pet alerts
app.use(scanRoutes);          // /scans
app.use(accountRoutes);       // /me, /me/password  <- view/edit profile, change password, delete account
app.use(calendarRoutes);      // /calendar-events    <- vet/groomer appointments & medication reminders

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
