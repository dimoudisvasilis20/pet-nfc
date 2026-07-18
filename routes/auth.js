const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db/database");

const router = express.Router();

/*
========================================
REGISTER
========================================
*/

router.post("/register", async (req, res) => {

    const {
        first_name,
        last_name,
        email,
        phone,
        password
    } = req.body;

    try {

        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query(
            `
            INSERT INTO users
            (
                first_name,
                last_name,
                email,
                phone,
                password,
                status
            )
            VALUES
            (
                $1,$2,$3,$4,$5,'active'
            )
            `,
            [
                first_name,
                last_name,
                email,
                phone,
                hashedPassword
            ]
        );

        res.send("User created successfully");

    } catch (error) {

        console.log(error);
        res.status(500).send("Register error");

    }

});

/*
========================================
LOGIN
========================================
*/

router.post("/login", async (req, res) => {

    const { email, password } = req.body;

    try {

        const result = await pool.query(
            "SELECT * FROM users WHERE email=$1",
            [email]
        );

        if (result.rows.length === 0) {

            return res.status(401).send("User not found");

        }

        const user = result.rows[0];

        const match = await bcrypt.compare(
            password,
            user.password
        );

        if (!match) {

            return res.status(401).send("Wrong password");

        }

        req.session.user_id = user.id;

        res.json({
            message: "Login successful",
            user_id: user.id,
            name: user.first_name,
            role: user.role
        });

    } catch (error) {

        console.log(error);
        res.status(500).send("Login error");

    }

});

/*
========================================
LOGOUT
========================================
*/

router.post("/logout", (req, res) => {

    req.session.destroy(() => {

        res.json({ message: "Logged out" });

    });

});

module.exports = router;