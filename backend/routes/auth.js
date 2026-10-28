const express = require("express");
const cookieParser = require("cookie-parser");
const siteAuth = require("../services/siteAuth");

const router = express.Router();

router.use(cookieParser());

router.post("/register", siteAuth.register);
router.post("/login", siteAuth.login);
router.post("/logout", siteAuth.logout);
router.get("/me", siteAuth.me);

module.exports = router;
