/*
 * Express router for contact API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const router = express.Router();

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

function sanitize(s = "") {
  return String(s).slice(0, 4000);
}

const lastHit = new Map();
function tooSoon(ip) {
  const now = Date.now();
  const prev = lastHit.get(ip) || 0;
  lastHit.set(ip, now);
  return now - prev < 30_000;
}

router.post("/", express.json(), async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    if (tooSoon(ip)) return res.status(429).json({ error: "Too many requests. Try again in a bit." });

    const { name, email, topic = "General", message } = req.body || {};
    if (!name || !message) return res.status(400).json({ error: "Missing required fields." });

    const payload = {
      content: null,
      embeds: [
        {
          title: "New Contact Form Submission",
          color: 0x4f46e5,
          fields: [
            { name: "From", value: sanitize(name), inline: true },
            { name: "Email", value: sanitize(email || "N/A"), inline: true },
            { name: "Topic", value: sanitize(topic), inline: true },
            { name: "Message", value: sanitize(message) },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };

    if (WEBHOOK) {
      await fetch(WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      console.log("[contact] ", { name, email, topic, message });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[contact] error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

module.exports = router;
