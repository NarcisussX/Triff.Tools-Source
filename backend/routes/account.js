const express = require("express");
const cookieParser = require("cookie-parser");
const siteAuth = require("../services/siteAuth");
const {
  listAccountGeneratedLinks,
  removeAccountGeneratedLink,
  renameAccountGeneratedLink,
} = require("../services/accountLinks");
const {
  collectDeletionSummary,
  deleteAccount,
} = require("../services/accountDeletion");
const { ensureBattleReportSchema } = require("../services/battleReports/db");
const { ensureCombatLogReportSchema } = require("../services/combatLogReports/db");

const router = express.Router();

router.use(cookieParser());

function noStore(res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
}

function linkKindParam(value) {
  if (value === "appraisals") return "appraisal";
  if (value === "battle-reports") return "battle_report";
  if (value === "combat-logs") return "combat_log_report";
  if (value === "triff-local" || value === "triff-local-reports") return "triff_local_report";
  return value;
}

router.get("/links", siteAuth.requireAuth, async (req, res) => {
  noStore(res);
  try {
    await ensureBattleReportSchema();
    await ensureCombatLogReportSchema();
    const links = await listAccountGeneratedLinks(req.siteUser.id, req.query.limit || 50);
    res.json({ ok: true, user: req.siteUser, ...links });
  } catch (err) {
    console.error("[account/links]", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to load account links" });
  }
});

router.get("/deletion-summary", siteAuth.requireAuth, async (req, res) => {
  noStore(res);
  try {
    const summary = await collectDeletionSummary(req.siteUser.id);
    res.json({ ok: true, user: req.siteUser, summary });
  } catch (err) {
    console.error("[account/deletion-summary]", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to load account deletion summary" });
  }
});

router.delete("/me", siteAuth.requireAuth, async (req, res) => {
  noStore(res);
  try {
    const result = await deleteAccount({ userId: req.siteUser.id, body: req.body || {} });
    siteAuth.clearSessionCookie(res, req);
    res.json({ ok: true, deleted: true, user: result.user, summary: result.summary });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("[account/delete-me]", err);
    res.status(status).json({
      ok: false,
      error: err.error || err.message || "account_delete_failed",
      message: err.message || "Failed to delete account.",
    });
  }
});

router.delete("/links/:kind/:targetId", siteAuth.requireAuth, async (req, res) => {
  noStore(res);
  try {
    const kind = linkKindParam(req.params.kind);
    const removed = await removeAccountGeneratedLink(req.siteUser.id, kind, req.params.targetId);
    if (!removed) return res.status(404).json({ ok: false, error: "link_not_found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[account/link-delete]", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to remove account link" });
  }
});

router.patch("/links/:kind/:targetId", siteAuth.requireAuth, async (req, res) => {
  noStore(res);
  try {
    const kind = linkKindParam(req.params.kind);
    const displayName = String(req.body?.displayName || "").trim();
    if (!displayName) return res.status(400).json({ ok: false, error: "display_name_required" });
    const link = await renameAccountGeneratedLink(req.siteUser.id, kind, req.params.targetId, displayName);
    if (!link) return res.status(404).json({ ok: false, error: "link_not_found" });
    res.json({
      ok: true,
      link: {
        kind: link.kind,
        targetId: link.target_id,
        displayName: link.display_name,
      },
    });
  } catch (err) {
    console.error("[account/link-rename]", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to rename account link" });
  }
});

module.exports = router;
