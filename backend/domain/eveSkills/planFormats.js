"use strict";

const { gzipSync } = require("node:zlib");
const formats = require("./formats");

function flattenParsedPlans(parsed) {
  const multiple = parsed.plans.length > 1;
  const entries = parsed.plans.flatMap((plan) => plan.rows.map((row) => ({
    ...row,
    level: row.targetLevel,
    type: row.entryType,
    group: row.groups?.[0] ?? (multiple ? plan.name : null),
    planName: plan.name,
  })));
  const warnings = [...parsed.warnings];
  if (multiple) warnings.push(`Imported ${parsed.plans.length} EVEMon plans into one ordered plan.`);
  return {
    ...parsed,
    name: parsed.plans[0]?.name ?? "Imported plan",
    description: parsed.plans[0]?.description ?? "",
    entries,
    warnings,
  };
}

function parsePlan(content, options = {}) {
  return flattenParsedPlans(formats.parsePlanPayload(content, options));
}

function exportPlan(payload, requestedFormat = "json") {
  const format = String(requestedFormat || "json").trim().toLowerCase();
  switch (format) {
    case "json":
      return {
        content: formats.exportPlanJson(payload),
        extension: "json",
        mimeType: "application/json; charset=utf-8",
      };
    case "csv":
      return {
        content: formats.exportPlanCsv(payload),
        extension: "csv",
        mimeType: "text/csv; charset=utf-8",
      };
    case "txt":
    case "text":
      return {
        content: formats.exportPlanText(payload),
        extension: "txt",
        mimeType: "text/plain; charset=utf-8",
      };
    case "xml":
    case "evemon":
      return {
        content: formats.exportEvemonXml(payload),
        extension: "xml",
        mimeType: "application/xml; charset=utf-8",
      };
    case "emp": {
      const xml = formats.exportEvemonXml(payload);
      return {
        content: gzipSync(Buffer.from(xml, "utf8")).toString("base64"),
        encoding: "base64",
        extension: "emp",
        mimeType: "application/gzip",
      };
    }
    case "epb":
      {
      const xml = formats.exportEvemonXml({ plans: payload.plans ?? [payload] }, { multi: true });
      return {
        content: gzipSync(Buffer.from(xml, "utf8")).toString("base64"),
        encoding: "base64",
        extension: "epb",
        mimeType: "application/gzip",
      };
      }
    default:
      throw new formats.PlanFormatError(`Unsupported export format ${requestedFormat}`, "UNSUPPORTED_EXPORT_FORMAT");
  }
}

module.exports = {
  ...formats,
  exportPlan,
  parsePlan,
};
