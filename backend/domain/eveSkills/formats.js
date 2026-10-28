"use strict";

const { gunzipSync } = require("node:zlib");
const { TextDecoder } = require("node:util");
const { createSkillCatalog } = require("./plan");

const DEFAULT_MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024;
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

class PlanFormatError extends Error {
  constructor(message, code = "INVALID_PLAN_FORMAT", details) {
    super(message);
    this.name = "PlanFormatError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function byteLimit(value, fallback, label) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return number;
}

function isGzip(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function looksLikeBase64Gzip(text) {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 8 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return null;
  }
  const decoded = Buffer.from(compact, "base64");
  return isGzip(decoded) ? decoded : null;
}

function inputBuffer(payload, options) {
  let source = payload;
  let encoding = options.encoding;
  let filename = options.filename;

  if (
    payload
    && typeof payload === "object"
    && !Buffer.isBuffer(payload)
    && !(payload instanceof Uint8Array)
  ) {
    filename = payload.filename ?? filename;
    if (payload.base64 !== undefined) {
      source = payload.base64;
      encoding = "base64";
    } else {
      source = payload.data ?? payload.content ?? payload.payload;
      encoding = payload.encoding ?? encoding;
    }
  }

  if (Buffer.isBuffer(source)) return { buffer: source, filename };
  if (source instanceof Uint8Array) return { buffer: Buffer.from(source), filename };
  if (typeof source !== "string") {
    throw new TypeError("plan payload must be a string, Buffer, Uint8Array, or payload object");
  }

  const dataUrl = /^data:[^,]*;base64,(.*)$/is.exec(source);
  if (dataUrl) return { buffer: Buffer.from(dataUrl[1].replace(/\s+/g, ""), "base64"), filename };
  if (String(encoding).toLowerCase() === "base64") {
    const compact = source.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
      throw new PlanFormatError("Invalid base64 plan payload", "INVALID_BASE64");
    }
    return { buffer: Buffer.from(compact, "base64"), filename };
  }

  const decodedGzip = looksLikeBase64Gzip(source);
  return { buffer: decodedGzip ?? Buffer.from(source, "utf8"), filename };
}

function decodePlanPayload(payload, options = {}) {
  const maxCompressedBytes = byteLimit(
    options.maxCompressedBytes,
    DEFAULT_MAX_COMPRESSED_BYTES,
    "maxCompressedBytes",
  );
  const maxDecompressedBytes = byteLimit(
    options.maxDecompressedBytes,
    DEFAULT_MAX_DECOMPRESSED_BYTES,
    "maxDecompressedBytes",
  );
  const { buffer, filename } = inputBuffer(payload, options);
  if (buffer.length > maxCompressedBytes) {
    throw new PlanFormatError(
      `Plan payload exceeds ${maxCompressedBytes} bytes`,
      "COMPRESSED_SIZE_LIMIT",
      { actualBytes: buffer.length, limitBytes: maxCompressedBytes },
    );
  }

  const compressed = isGzip(buffer);
  let decoded = buffer;
  if (compressed) {
    try {
      decoded = gunzipSync(buffer, { maxOutputLength: maxDecompressedBytes });
    } catch (error) {
      const limitError = /maxoutputlength|larger than/i.test(String(error?.message));
      throw new PlanFormatError(
        limitError ? "Decompressed plan exceeds the configured limit" : "Invalid gzip plan payload",
        limitError ? "DECOMPRESSED_SIZE_LIMIT" : "INVALID_GZIP",
        { cause: error?.message },
      );
    }
  }
  if (decoded.length > maxDecompressedBytes) {
    throw new PlanFormatError(
      `Decoded plan exceeds ${maxDecompressedBytes} bytes`,
      "DECOMPRESSED_SIZE_LIMIT",
      { actualBytes: decoded.length, limitBytes: maxDecompressedBytes },
    );
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch (error) {
    throw new PlanFormatError("Plan is not valid UTF-8", "INVALID_UTF8", { cause: error?.message });
  }
  if (text.includes("\0")) throw new PlanFormatError("Plan contains NUL bytes", "INVALID_TEXT");
  return {
    text: text.replace(/^\uFEFF/, ""),
    filename,
    compressed,
    compressedBytes: buffer.length,
    decompressedBytes: decoded.length,
  };
}

function decodeXmlEntities(value) {
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return "\"";
    if (lower === "apos") return "'";
    const codePoint = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      throw new PlanFormatError("Invalid numeric XML entity", "INVALID_XML_ENTITY");
    }
    return String.fromCodePoint(codePoint);
  }).replace(/&[A-Za-z_:][\w:.-]*;/g, (entity) => {
    throw new PlanFormatError(`Unsupported XML entity ${entity}`, "UNSUPPORTED_XML_ENTITY");
  });
}

function xmlAttributes(source) {
  const attributes = {};
  const expression = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = expression.exec(source)) !== null) {
    attributes[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function attributeValue(attributes, ...names) {
  const lowered = new Map(Object.entries(attributes).map(([key, value]) => [key.toLowerCase(), value]));
  for (const name of names) {
    if (lowered.has(name.toLowerCase())) return lowered.get(name.toLowerCase());
  }
  return undefined;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagText(body, tagName) {
  const tag = escapeRegex(tagName);
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i").exec(body);
  return match ? decodeXmlEntities(match[1].replace(/<[^>]*>/g, "").trim()) : undefined;
}

function allTagText(body, tagName) {
  const tag = escapeRegex(tagName);
  const expression = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
  const values = [];
  let match;
  while ((match = expression.exec(body)) !== null) {
    values.push(decodeXmlEntities(match[1].replace(/<[^>]*>/g, "").trim()));
  }
  return values;
}

function numericOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseRemap(entryBody) {
  const modern = /<remapping\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/remapping\s*>)/i.exec(entryBody);
  if (!modern) return null;
  const attributes = xmlAttributes(modern[1]);
  const body = modern[2] ?? "";
  const legacyValues = allTagText(body, "int").map(Number).filter(Number.isFinite);
  return {
    status: attributeValue(attributes, "status") ?? tagText(body, "Status") ?? null,
    perception: numericOrNull(attributeValue(attributes, "per")),
    intelligence: numericOrNull(attributeValue(attributes, "int")),
    memory: numericOrNull(attributeValue(attributes, "mem")),
    willpower: numericOrNull(attributeValue(attributes, "wil")),
    charisma: numericOrNull(attributeValue(attributes, "cha")),
    description: attributeValue(attributes, "description")
      ?? tagText(body, "AttributesDescription")
      ?? null,
    legacyBaseAttributes: legacyValues.length ? legacyValues : undefined,
  };
}

function parseXmlEntry(attributesSource, body, planIndex, entryIndex) {
  const attributes = xmlAttributes(attributesSource);
  const warnings = [];
  const idValue = attributeValue(attributes, "skillID", "skillTypeId", "typeID");
  const name = attributeValue(attributes, "skill", "name") ?? tagText(body, "SkillName") ?? null;
  const levelValue = attributeValue(attributes, "level") ?? tagText(body, "Level");
  const targetLevel = Number(levelValue);
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 5) {
    warnings.push({ code: "INVALID_LEVEL", planIndex, entryIndex, value: levelValue });
    return { row: null, warnings };
  }

  let skillTypeId = null;
  if (idValue !== undefined && idValue !== "") {
    skillTypeId = Number(idValue);
    if (!Number.isSafeInteger(skillTypeId) || skillTypeId <= 0) {
      warnings.push({ code: "INVALID_SKILL_ID", planIndex, entryIndex, value: idValue });
      skillTypeId = null;
    }
  }
  if (!skillTypeId && !name) {
    warnings.push({ code: "MISSING_SKILL", planIndex, entryIndex });
    return { row: null, warnings };
  }

  const priorityValue = attributeValue(attributes, "priority") ?? tagText(body, "Priority");
  const priority = numericOrNull(priorityValue);
  const modernGroups = allTagText(body, "group");
  const legacyGroups = allTagText(body, "anyType");
  return {
    row: {
      skillTypeId,
      skillName: name,
      targetLevel,
      priority,
      entryType: attributeValue(attributes, "type") ?? tagText(body, "EntryType") ?? null,
      notes: tagText(body, "notes") ?? tagText(body, "Notes") ?? "",
      groups: modernGroups.length ? modernGroups : legacyGroups,
      remap: parseRemap(body),
      source: { format: "evemon-xml", planIndex, entryIndex },
    },
    warnings,
  };
}

function parsePlanElement(attributesSource, body, planIndex, inheritedRevision) {
  const attributes = xmlAttributes(attributesSource);
  const rows = [];
  const warnings = [];
  const entryExpression = /<entry\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/entry\s*>)/gi;
  let entryMatch;
  let entryIndex = 0;
  while ((entryMatch = entryExpression.exec(body)) !== null) {
    const parsed = parseXmlEntry(entryMatch[1], entryMatch[2] ?? "", planIndex, entryIndex);
    if (parsed.row) rows.push(parsed.row);
    warnings.push(...parsed.warnings);
    entryIndex += 1;
  }
  return {
    name: attributeValue(attributes, "name") ?? `Imported plan ${planIndex + 1}`,
    owner: attributeValue(attributes, "owner") ?? null,
    description: attributeValue(attributes, "description") ?? "",
    revision: numericOrNull(attributeValue(attributes, "revision")) ?? inheritedRevision ?? null,
    rows,
    warnings,
  };
}

function rejectUnsafeXml(text) {
  if (/<!\s*DOCTYPE\b/i.test(text)) {
    throw new PlanFormatError("XML document types are not allowed", "XML_DTD_FORBIDDEN");
  }
  if (/<!\s*ENTITY\b/i.test(text)) {
    throw new PlanFormatError("XML entity declarations are not allowed", "XML_ENTITY_FORBIDDEN");
  }
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, "");
  if (/<!\[CDATA\[/i.test(withoutComments)) {
    throw new PlanFormatError("XML CDATA sections are not supported", "XML_CDATA_UNSUPPORTED");
  }
  return withoutComments;
}

function parseEvemonXml(text) {
  const safe = rejectUnsafeXml(text).replace(/^\s*<\?xml\b[^?]*\?>/i, "").trim();
  const multi = /^<plans\b([^>]*)>([\s\S]*)<\/plans\s*>$/i.exec(safe);
  if (multi) {
    const rootAttributes = xmlAttributes(multi[1]);
    const revision = numericOrNull(attributeValue(rootAttributes, "revision"));
    const plans = [];
    const planExpression = /<plan\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/plan\s*>)/gi;
    let match;
    while ((match = planExpression.exec(multi[2])) !== null) {
      plans.push(parsePlanElement(match[1], match[2] ?? "", plans.length, revision));
    }
    if (!plans.length) throw new PlanFormatError("The plans document contains no plans", "EMPTY_PLANS");
    return { format: "evemon-xml", root: "plans", plans };
  }

  const single = /^<plan\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/plan\s*>)$/i.exec(safe);
  if (!single) throw new PlanFormatError("XML root must be plan or plans", "INVALID_XML_ROOT");
  return {
    format: "evemon-xml",
    root: "plan",
    plans: [parsePlanElement(single[1], single[2] ?? "", 0, null)],
  };
}

function parseDelimited(text, delimiter = ",") {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === "\"" && field.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new PlanFormatError("Unterminated quoted CSV field", "INVALID_CSV");
  if (field.length || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  return records;
}

function normalizedHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstColumn(row, indexByName, ...names) {
  for (const name of names) {
    const index = indexByName.get(normalizedHeader(name));
    if (index !== undefined && row[index] !== undefined && row[index] !== "") return row[index];
  }
  return undefined;
}

function parseCsvPlan(text, delimiter = ",") {
  const records = parseDelimited(text, delimiter).filter((record) => record.some((field) => field.trim()));
  if (!records.length) throw new PlanFormatError("CSV plan is empty", "EMPTY_PLAN");
  const indexByName = new Map(records[0].map((header, index) => [normalizedHeader(header), index]));
  if (!["level", "targetlevel", "finishedlevel"].some((key) => indexByName.has(key))) {
    throw new PlanFormatError("CSV plan requires a target level column", "INVALID_CSV_HEADER");
  }
  const rows = [];
  const warnings = [];
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index];
    const levelValue = firstColumn(record, indexByName, "targetLevel", "level", "finishedLevel");
    const targetLevel = Number(levelValue);
    if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 5) {
      warnings.push({ code: "INVALID_LEVEL", row: index + 1, value: levelValue });
      continue;
    }
    const idValue = firstColumn(record, indexByName, "skillTypeId", "skillId", "typeId", "skillID");
    const parsedId = idValue === undefined ? null : Number(idValue);
    const skillTypeId = Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : null;
    const skillName = firstColumn(record, indexByName, "skillName", "skill", "name", "typeName") ?? null;
    if (!skillTypeId && !skillName) {
      warnings.push({ code: "MISSING_SKILL", row: index + 1 });
      continue;
    }
    rows.push({
      skillTypeId,
      skillName,
      targetLevel,
      priority: numericOrNull(firstColumn(record, indexByName, "priority")),
      entryType: firstColumn(record, indexByName, "entryType", "type") ?? null,
      notes: firstColumn(record, indexByName, "notes", "note") ?? "",
      groups: String(firstColumn(record, indexByName, "groups", "group") ?? "")
        .split("|").map((value) => value.trim()).filter(Boolean),
      remap: null,
      source: { format: delimiter === "\t" ? "tsv" : "csv", row: index + 1 },
    });
  }
  return {
    format: delimiter === "\t" ? "tsv" : "csv",
    root: null,
    plans: [{ name: "Imported plan", owner: null, description: "", revision: null, rows, warnings }],
  };
}

const ROMAN_LEVELS = Object.freeze({ I: 1, II: 2, III: 3, IV: 4, V: 5 });

function parseTextPlan(text) {
  const rows = [];
  const warnings = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const withoutNumber = line.replace(/^\d+[.)]\s*/, "");
    const match = /^(.*?)\s+(?:level\s+)?(I{1,3}|IV|V|[1-5])$/i.exec(withoutNumber);
    if (!match || !match[1].trim()) {
      warnings.push({ code: "UNPARSED_TEXT_LINE", line: index + 1, value: line });
      continue;
    }
    const levelToken = match[2].toUpperCase();
    rows.push({
      skillTypeId: null,
      skillName: match[1].trim(),
      targetLevel: ROMAN_LEVELS[levelToken] ?? Number(levelToken),
      priority: null,
      entryType: null,
      notes: "",
      groups: [],
      remap: null,
      source: { format: "text", line: index + 1 },
    });
  }
  if (!rows.length && warnings.length) {
    throw new PlanFormatError("No skill rows could be parsed from text", "INVALID_TEXT_PLAN", warnings);
  }
  return {
    format: "text",
    root: null,
    plans: [{ name: "Imported plan", owner: null, description: "", revision: null, rows, warnings }],
  };
}

function nativeRows(value) {
  if (Array.isArray(value)) return value;
  return value?.rows ?? value?.entries ?? value?.desiredTargets ?? value?.targets ?? [];
}

function canonicalNativeRow(row, index) {
  const skillTypeIdValue = row.skillTypeId ?? row.skill_id ?? row.typeId ?? row.skillId;
  const skillTypeId = Number(skillTypeIdValue);
  const level = Number(row.targetLevel ?? row.level ?? row.finishedLevel);
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    throw new PlanFormatError(`Native JSON row ${index} has an invalid level`, "INVALID_LEVEL");
  }
  return {
    ...row,
    skillTypeId: Number.isSafeInteger(skillTypeId) && skillTypeId > 0 ? skillTypeId : null,
    skillName: row.skillName ?? row.name ?? null,
    targetLevel: level,
    entryType: row.entryType ?? row.type ?? null,
    groups: Array.isArray(row.groups)
      ? row.groups.map(String)
      : (row.group === undefined || row.group === null || row.group === "" ? [] : [String(row.group)]),
    notes: String(row.notes ?? ""),
    remap: row.remap ?? row.remapping ?? null,
    source: { format: "native-json", row: index + 1 },
  };
}

function parseNativeJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new PlanFormatError("Invalid plan JSON", "INVALID_JSON", { cause: error?.message });
  }
  const rawPlans = Array.isArray(value?.plans) ? value.plans : [value];
  const plans = rawPlans.map((plan, planIndex) => ({
    name: String(plan?.name ?? `Imported plan ${planIndex + 1}`),
    owner: plan?.owner ?? null,
    description: String(plan?.description ?? ""),
    revision: plan?.revision ?? value?.version ?? null,
    rows: nativeRows(plan).map(canonicalNativeRow),
    warnings: [],
  }));
  return { format: "native-json", root: null, plans };
}

function resolvePlanSkills(result, skills) {
  if (!skills) return result;
  const catalog = createSkillCatalog(skills);
  for (const [planIndex, plan] of result.plans.entries()) {
    plan.rows = plan.rows.map((row, rowIndex) => {
      const byId = row.skillTypeId ? catalog.get(row.skillTypeId) : undefined;
      const byName = row.skillName ? catalog.getByName(row.skillName) : undefined;
      if (byId) {
        if (row.skillName && byId.name.toLocaleLowerCase("en-US") !== row.skillName.toLocaleLowerCase("en-US")) {
          plan.warnings.push({
            code: "SKILL_ID_NAME_MISMATCH",
            planIndex,
            rowIndex,
            skillTypeId: row.skillTypeId,
            importedName: row.skillName,
            canonicalName: byId.name,
          });
        }
        return { ...row, skillName: byId.name, resolvedBy: "id" };
      }
      if (byName) {
        if (row.skillTypeId) {
          plan.warnings.push({
            code: "UNKNOWN_ID_NAME_FALLBACK",
            planIndex,
            rowIndex,
            importedSkillTypeId: row.skillTypeId,
            resolvedSkillTypeId: byName.skillTypeId,
          });
        }
        return {
          ...row,
          skillTypeId: byName.skillTypeId,
          skillName: byName.name,
          resolvedBy: "name",
        };
      }
      plan.warnings.push({
        code: "UNRESOLVED_SKILL",
        planIndex,
        rowIndex,
        skillTypeId: row.skillTypeId,
        skillName: row.skillName,
      });
      return { ...row, resolvedBy: null };
    });
  }
  return result;
}

function parsePlanPayload(payload, options = {}) {
  const decoded = decodePlanPayload(payload, options);
  const trimmed = decoded.text.trim();
  if (!trimmed) throw new PlanFormatError("Plan payload is empty", "EMPTY_PLAN");

  let result;
  if (trimmed.startsWith("<")) {
    result = parseEvemonXml(trimmed);
  } else if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    result = parseNativeJson(trimmed);
  } else {
    const firstLine = trimmed.split(/\r?\n/, 1)[0];
    const normalized = firstLine.toLowerCase().replace(/[^a-z0-9,\t]/g, "");
    if (firstLine.includes("\t") && /level/.test(normalized)) {
      result = parseCsvPlan(trimmed, "\t");
    } else if (firstLine.includes(",") && /level/.test(normalized)) {
      result = parseCsvPlan(trimmed, ",");
    } else {
      result = parseTextPlan(trimmed);
    }
  }
  resolvePlanSkills(result, options.skills);
  const warnings = result.plans.flatMap((plan) => plan.warnings);
  return {
    ...result,
    filename: decoded.filename ?? null,
    compressed: decoded.compressed,
    compressedBytes: decoded.compressedBytes,
    decompressedBytes: decoded.decompressedBytes,
    warnings,
  };
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function exportPlans(input, options = {}) {
  const multi = options.multi === true || Array.isArray(input?.plans);
  const sourcePlans = Array.isArray(input?.plans)
    ? input.plans
    : (multi && Array.isArray(input) ? input : [input]);
  return {
    multi,
    plans: sourcePlans.map((plan, index) => ({
      name: String(plan?.name ?? `Skill plan ${index + 1}`),
      owner: String(plan?.owner ?? ZERO_GUID),
      description: String(plan?.description ?? ""),
      revision: Number(plan?.revision ?? options.revision ?? 1),
      rows: nativeRows(plan),
    })),
  };
}

function exportRow(row, index) {
  return canonicalNativeRow(row, index);
}

function remapXml(remap) {
  if (!remap) return "";
  const attributes = [
    ["status", remap.status],
    ["per", remap.perception ?? remap.per],
    ["int", remap.intelligence ?? remap.int],
    ["mem", remap.memory ?? remap.mem],
    ["wil", remap.willpower ?? remap.wil],
    ["cha", remap.charisma ?? remap.cha],
    ["description", remap.description],
  ].filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${xmlEscape(value)}"`).join("");
  return `<remapping${attributes} />`;
}

function entryXml(rawRow, index) {
  const row = exportRow(rawRow, index);
  const entryType = row.entryType ?? (row.autoAdded ? "Prerequisite" : "Planned");
  const attributes = [
    row.skillTypeId ? `skillID="${row.skillTypeId}"` : null,
    row.skillName ? `skill="${xmlEscape(row.skillName)}"` : null,
    `level="${row.targetLevel}"`,
    `priority="${Number(row.priority ?? 3)}"`,
    `type="${xmlEscape(entryType)}"`,
  ].filter(Boolean).join(" ");
  const children = [];
  if (row.notes) children.push(`<notes>${xmlEscape(row.notes)}</notes>`);
  for (const group of row.groups ?? []) children.push(`<group>${xmlEscape(group)}</group>`);
  if (row.remap) children.push(remapXml(row.remap));
  return children.length
    ? `<entry ${attributes}>${children.join("")}</entry>`
    : `<entry ${attributes} />`;
}

function planXml(plan, includeRevision) {
  const attributes = [
    `name="${xmlEscape(plan.name)}"`,
    `owner="${xmlEscape(plan.owner)}"`,
    plan.description ? `description="${xmlEscape(plan.description)}"` : null,
    includeRevision ? `revision="${plan.revision}"` : null,
  ].filter(Boolean).join(" ");
  return `<plan ${attributes}>${plan.rows.map(entryXml).join("")}</plan>`;
}

function exportEvemonXml(input, options = {}) {
  const normalized = exportPlans(input, options);
  const declaration = "<?xml version=\"1.0\" encoding=\"utf-8\"?>";
  if (!normalized.multi && normalized.plans.length === 1) {
    return `${declaration}${planXml(normalized.plans[0], true)}`;
  }
  const revision = Number(options.revision ?? normalized.plans[0]?.revision ?? 1);
  return `${declaration}<plans revision="${revision}">${normalized.plans
    .map((plan) => planXml(plan, false)).join("")}</plans>`;
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function exportPlanCsv(input) {
  const normalized = exportPlans(input).plans[0];
  const header = ["skillTypeId", "skillName", "targetLevel", "priority", "entryType", "notes", "groups"];
  const rows = normalized.rows.map((row, index) => {
    const canonical = exportRow(row, index);
    return [
      canonical.skillTypeId ?? "",
      canonical.skillName ?? "",
      canonical.targetLevel,
      canonical.priority ?? "",
      canonical.entryType ?? (canonical.autoAdded ? "Prerequisite" : "Planned"),
      canonical.notes ?? "",
      (canonical.groups ?? []).join("|"),
    ].map(csvField).join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

const LEVEL_ROMANS = Object.freeze(["", "I", "II", "III", "IV", "V"]);

function exportPlanText(input) {
  const normalized = exportPlans(input).plans[0];
  return normalized.rows.map((row, index) => {
    const canonical = exportRow(row, index);
    return `${canonical.skillName ?? `Skill ${canonical.skillTypeId}`} ${LEVEL_ROMANS[canonical.targetLevel]}`;
  }).join("\n");
}

function exportPlanJson(input, options = {}) {
  const normalized = exportPlans(input, options);
  return JSON.stringify({
    format: "triff-eve-skill-plan",
    version: 1,
    plans: normalized.plans.map((plan) => ({
      name: plan.name,
      owner: plan.owner,
      description: plan.description,
      rows: plan.rows.map(exportRow),
    })),
  }, null, options.pretty === false ? 0 : 2);
}

module.exports = {
  DEFAULT_MAX_COMPRESSED_BYTES,
  DEFAULT_MAX_DECOMPRESSED_BYTES,
  PlanFormatError,
  decodePlanPayload,
  exportEvemonXml,
  exportPlanCsv,
  exportPlanJson,
  exportPlanText,
  parseEvemonXml,
  parsePlanPayload,
};
