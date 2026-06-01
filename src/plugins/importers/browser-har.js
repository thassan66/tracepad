const fs = require("fs");
const path = require("path");

async function importSessionData(context) {
  const fileFlag = context.flags.file || context.args[0];
  if (!fileFlag) {
    throw new Error("browser-har importer requires --file <path-to.har>");
  }

  const sourcePath = path.isAbsolute(fileFlag) ? fileFlag : path.resolve(context.repoRoot, fileFlag);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`HAR file not found: ${sourcePath}`);
  }

  const har = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const entries = Array.isArray(har.entries) ? har.entries : har.log && Array.isArray(har.log.entries) ? har.log.entries : [];
  if (entries.length === 0) {
    return { events: [] };
  }

  const slowMs = Number(context.flags["slow-ms"] || 3000);
  const includeAll = Boolean(context.flags.all);
  const findings = entries.map((entry) => normalizeEntry(entry, context.helpers, slowMs)).filter((entry) => includeAll || entry.isFailure || entry.isSlow);
  const summaryText = renderSummary({
    sourcePath,
    totalCount: entries.length,
    importedCount: findings.length,
    failureCount: findings.filter((entry) => entry.isFailure).length,
    slowCount: findings.filter((entry) => entry.isSlow).length,
    slowMs,
    findings,
  });

  const events = [];
  const storedPath = context.helpers.storeArtifactText(summaryText, `${path.basename(sourcePath)}.browser-har-summary.md`);
  events.push(
    context.helpers.createEvent("snapshot", {
      snapshotKind: "browser-har-summary",
      storedPath,
      changedFiles: findings.length,
      note: context.helpers.redactText(context.flags.note || `Imported browser HAR evidence from ${path.basename(sourcePath)}`),
    })
  );

  for (const finding of findings.slice(0, Number(context.flags["max-events"] || 80))) {
    events.push(
      {
        at: finding.startedAt || new Date().toISOString(),
        type: "note",
        kind: finding.isFailure ? "finding" : "context",
        text: renderFinding(finding),
      }
    );
  }

  return { events };
}

function normalizeEntry(entry, helpers, slowMs) {
  const request = entry.request || {};
  const response = entry.response || {};
  const status = Number(response.status || 0);
  const timeMs = Number(entry.time || 0);
  const method = helpers.redactText(request.method || "GET");
  const url = helpers.redactText(request.url || "");
  const statusText = helpers.redactText(response.statusText || "");
  const startedAt = helpers.redactText(entry.startedDateTime || "");
  const pageRef = helpers.redactText(entry.pageref || "");
  const error = helpers.redactText(entry._error || entry.error || "");
  const isFailure = Boolean(error) || status === 0 || status >= 400;
  const isSlow = timeMs >= slowMs;

  return {
    method,
    url,
    status,
    statusText,
    startedAt,
    pageRef,
    error,
    timeMs,
    isFailure,
    isSlow,
  };
}

function renderSummary(model) {
  const lines = [];
  lines.push("# Browser HAR Evidence");
  lines.push("");
  lines.push(`- Source: ${model.sourcePath}`);
  lines.push(`- Total requests: ${model.totalCount}`);
  lines.push(`- Imported requests: ${model.importedCount}`);
  lines.push(`- Failed/error requests: ${model.failureCount}`);
  lines.push(`- Slow requests: ${model.slowCount} at ${model.slowMs}ms threshold`);
  lines.push("");
  lines.push("## High-Signal Requests");

  if (model.findings.length === 0) {
    lines.push("- No failed or slow requests found.");
    return lines.join("\n");
  }

  for (const entry of model.findings) {
    lines.push(`- ${renderFinding(entry)}`);
  }

  return lines.join("\n");
}

function renderFinding(entry) {
  const parts = [];
  if (entry.startedAt) {
    parts.push(entry.startedAt);
  }
  parts.push(`${entry.method} ${entry.url || "(missing url)"}`);
  parts.push(`status ${entry.status || "unknown"}`);
  if (entry.statusText) {
    parts.push(entry.statusText);
  }
  if (entry.timeMs) {
    parts.push(`${Math.round(entry.timeMs)}ms`);
  }
  if (entry.error) {
    parts.push(`error: ${entry.error}`);
  }
  if (entry.pageRef) {
    parts.push(`page: ${entry.pageRef}`);
  }
  return parts.join(" | ");
}

module.exports = { importSessionData };
