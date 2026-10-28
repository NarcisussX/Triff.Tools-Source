/* Additive API boundary; calculations and validation of module legality stay in eos. */
const MAX_BYTES = 256 * 1024;

function positiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function createRateLimiter({
  perMinute = positiveInteger(process.env.FITTING_COMBAT_PROFILE_RATE_PER_MINUTE, 20),
  burst = positiveInteger(process.env.FITTING_COMBAT_PROFILE_RATE_BURST, 40),
} = {}) {
  const buckets = new Map();
  return function consume(key, now = Date.now()) {
    // Refilled, inactive buckets no longer carry rate-limit state.
    const expiry = Math.max(60_000, burst / perMinute * 60_000);
    for (const [id, bucket] of buckets) {
      if (now - bucket.updatedAt >= expiry) buckets.delete(id);
    }
    if (!buckets.has(key) && buckets.size >= 10_000) return false;
    const bucket = buckets.get(key) || { tokens: burst, updatedAt: now };
    bucket.tokens = Math.min(burst, bucket.tokens + Math.max(0, now - bucket.updatedAt) * perMinute / 60_000);
    bucket.updatedAt = now;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    buckets.set(key, bucket);
    return allowed;
  };
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRequest(body) {
  if (!object(body)) throw new Error("Request must be a JSON object.");
  const allowed = new Set(["eft", "eftText", "text", "payload", "skillProfile", "skillOverrides", "moduleOverrides"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error("Unknown combat-profile request field.");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BYTES) {
    throw new Error("Combat profile request exceeds 256 KiB.");
  }
  const inputKeys = ["eft", "eftText", "text", "payload"].filter((key) => body[key] != null);
  if (inputKeys.length !== 1) throw new Error("Supply exactly one of eft, eftText, text, or payload.");
  const key = inputKeys[0];
  if (key !== "payload" && (typeof body[key] !== "string" || !body[key].trim())) {
    throw new Error("EFT must be a non-empty string.");
  }
  if (key === "payload") {
    if (!object(body.payload)) throw new Error("payload must be a JSON object.");
    const target = Object.hasOwn(body.payload, "targetFit") ? body.payload.targetFit : body.payload;
    if (!object(target)) throw new Error("targetFit must be a JSON object.");
    if (!Object.hasOwn(body.payload, "targetFit") && ["sourceFits", "projectedLinks", "commandLinks"].some((field) => Object.hasOwn(body.payload, field))) {
      throw new Error("Cross-fit inputs require a targetFit envelope.");
    }
    const sources = body.payload.sourceFits || [];
    if (!Array.isArray(sources) || sources.length > 8 || sources.some((source) => !object(source) || !object(source.fitState))) {
      throw new Error("sourceFits must contain at most eight fitState objects.");
    }
    if (body.payload.graphTargets != null) throw new Error("graphTargets are not combat-profile inputs.");
    if (body.skillProfile != null || body.skillOverrides != null) {
      throw new Error("Put skillProfile and skillOverrides inside payload when using payload input.");
    }
  }
  if (body.moduleOverrides != null && (!Array.isArray(body.moduleOverrides) || body.moduleOverrides.length > 64)) {
    throw new Error("moduleOverrides must contain at most 64 entries.");
  }
  return {
    [key === "payload" ? key : "eft"]: body[key],
    ...(body.moduleOverrides != null ? { moduleOverrides: body.moduleOverrides } : {}),
    ...(key !== "payload" ? { skillProfile: body.skillProfile, skillOverrides: body.skillOverrides } : {}),
  };
}

function failure(code, message) {
  return { ok: false, combatProfileSchemaVersion: "1.1.0", profile: null, warnings: [], errors: [{ code, message }] };
}

function createHandler({ client, prepareSkills, requestIp, consume = createRateLimiter(), logError = console.error }) {
  return async function combatProfileHandler(req, res) {
    res.set("Cache-Control", "no-store");
    if (!consume(`ip:${requestIp(req)}`)) {
      res.set("Retry-After", "60");
      return res.status(429).json(failure("rate_limited", "Combat profile rate limit exceeded."));
    }
    let body;
    try {
      body = readRequest(req.body);
    } catch (error) {
      return res.status(400).json(failure("invalid_combat_profile_request", error.message));
    }
    try {
      // Reuse the fitting route's owner-checked ESI skill resolver, including
      // each cross-fit source. Client-supplied ESI skills are never authoritative.
      const skillBody = body.payload || { skillProfile: body.skillProfile, skillOverrides: body.skillOverrides };
      const prepared = await prepareSkills(req, skillBody);
      if (body.payload) {
        // The shared resolver also prepares graph inputs for /calculate. This
        // endpoint has no graph target selection; remove its injected empty list.
        const { graphTargets: _graphTargets, ...fitPayload } = prepared.payload;
        body.payload = fitPayload;
      }
      else body.skillProfile = prepared.payload.skillProfile;
      const result = await client(body);
      if (!object(result) || typeof result.ok !== "boolean" || result.combatProfileSchemaVersion !== "1.1.0" || (result.ok && !object(result.profile))) {
        throw new Error("Invalid combat-profile service response.");
      }
      result.warnings = [...prepared.warnings, ...(result.warnings || [])];
      const internalFailure = result.errors?.some((error) => error.code === "combat_profile_failed");
      return res.status(internalFailure ? 502 : result.ok ? 200 : 422).json(result);
    } catch (error) {
      logError("[combat-profile] fitting-service error", error?.message || error);
      return res.status(502).json(failure("fitting_service_error", "The fitting service could not export this combat profile."));
    }
  };
}

module.exports = { createHandler, createRateLimiter, readRequest };
