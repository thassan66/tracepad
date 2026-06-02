const fs = require("fs");
const path = require("path");

async function importSessionData(context) {
  const fileFlag = context.flags.file || context.args[0];
  if (!fileFlag) {
    throw new Error("browser-capture importer requires --file <path-to-browser-capture.json>");
  }

  const sourcePath = path.isAbsolute(fileFlag) ? fileFlag : path.resolve(context.repoRoot, fileFlag);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Browser capture file not found: ${sourcePath}`);
  }

  const capture = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const tabs = Array.isArray(capture.tabs) ? capture.tabs : [];
  const rawEvents = Array.isArray(capture.events) ? capture.events : [];
  const normalizedEvents = normalizeEvents(rawEvents, tabs, context.helpers);
  const screenshots = collectScreenshots(capture, normalizedEvents, context.helpers);
  const summaryText = renderSummary({
    sourcePath,
    capture,
    tabs,
    events: normalizedEvents,
    screenshots,
    helpers: context.helpers,
  });

  const events = [];
  const storedPath = context.helpers.storeArtifactText(summaryText, `${path.basename(sourcePath)}.browser-capture-summary.md`);
  events.push(
    context.helpers.createEvent("snapshot", {
      snapshotKind: "browser-capture-summary",
      storedPath,
      changedFiles: normalizedEvents.length + screenshots.length + tabs.length,
      note: context.helpers.redactText(context.flags.note || `Imported browser capture from ${path.basename(sourcePath)}`),
    })
  );

  for (const tab of tabs) {
    const title = cleanText(tab.title, context.helpers);
    const url = cleanText(tab.url, context.helpers);
    if (!title && !url) {
      continue;
    }
    events.push(
      context.helpers.createEvent("note", {
        at: cleanText(tab.capturedAt || "", context.helpers) || new Date().toISOString(),
        kind: "context",
        text: `Browser tab: ${title || "(untitled)"}${url ? ` | ${url}` : ""}`,
      })
    );
  }

  for (const screenshot of screenshots) {
    events.push(
      context.helpers.createEvent("attachment", {
        at: screenshot.at || new Date().toISOString(),
        originalPath: screenshot.source,
        storedPath: screenshot.storedPath,
        note: screenshot.note,
      })
    );
  }

  for (const item of normalizedEvents.slice(0, Number(context.flags["max-events"] || 120))) {
    events.push(toTracepadEvent(item, context.helpers));
  }

  return { events };
}

function normalizeEvents(rawEvents, tabs, helpers) {
  const tabEvents = tabs.flatMap((tab) => {
    const events = [];
    if (tab.note) {
      events.push({ type: "note", text: tab.note, title: tab.title, url: tab.url, at: tab.capturedAt });
    }
    if (tab.selectedText) {
      events.push({ type: "selection", text: tab.selectedText, title: tab.title, url: tab.url, at: tab.capturedAt });
    }
    if (tab.consoleErrors) {
      for (const error of asArray(tab.consoleErrors)) {
        events.push({ type: "console", level: "error", message: error.message || error, title: tab.title, url: tab.url, at: error.at || tab.capturedAt });
      }
    }
    if (tab.networkFailures) {
      for (const failure of asArray(tab.networkFailures)) {
        events.push({ type: "network", ...failure, title: tab.title, url: failure.url || tab.url, at: failure.at || tab.capturedAt });
      }
    }
    return events;
  });

  return rawEvents.concat(tabEvents).map((event) => ({
    type: cleanText(event.type || "note", helpers).toLowerCase(),
    level: cleanText(event.level || "", helpers).toLowerCase(),
    title: cleanText(event.title || event.tabTitle || "", helpers),
    url: cleanText(event.url || event.pageUrl || "", helpers),
    method: cleanText(event.method || "", helpers),
    status: event.status === undefined || event.status === null ? null : Number(event.status),
    durationMs: event.durationMs === undefined || event.durationMs === null ? null : Number(event.durationMs),
    message: cleanText(event.message || event.error || event.text || "", helpers),
    selectedText: cleanText(event.selectedText || event.selection || "", helpers),
    pageText: cleanText(event.pageText || "", helpers),
    logText: cleanText(event.logText || "", helpers),
    headings: asArray(event.headings).map((item) => cleanText(item, helpers)).filter(Boolean),
    note: cleanText(event.note || "", helpers),
    at: cleanText(event.at || event.capturedAt || "", helpers),
    raw: event,
  }));
}

function collectScreenshots(capture, normalizedEvents, helpers) {
  const screenshots = [];
  for (const tab of asArray(capture.tabs)) {
    if (tab.screenshot) {
      screenshots.push({ source: "browser tab screenshot", image: tab.screenshot, title: tab.title, url: tab.url, at: tab.capturedAt });
    }
  }
  for (const event of normalizedEvents) {
    if (event.raw && event.raw.screenshot) {
      screenshots.push({ source: "browser event screenshot", image: event.raw.screenshot, title: event.title, url: event.url, at: event.at });
    }
  }

  return screenshots.map((item, index) => storeScreenshot(item, index, helpers)).filter(Boolean);
}

function storeScreenshot(item, index, helpers) {
  const image = typeof item.image === "string" ? { dataUrl: item.image } : item.image || {};
  const dataUrl = image.dataUrl || image.dataURL || "";
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) {
    return null;
  }

  const extension = match[1].toLowerCase().replace("jpeg", "jpg");
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  const storedPath = helpers.storeArtifactBuffer(buffer, image.fileName || `browser-screenshot-${index + 1}.${extension}`);
  const label = cleanText(item.title || item.url || item.source || "browser screenshot", helpers);

  return {
    at: cleanText(item.at || "", helpers),
    source: item.source,
    storedPath,
    note: `Browser screenshot: ${label}`,
  };
}

function toTracepadEvent(item) {
  const text = renderEventText(item);
  if (item.type === "console" || item.type === "error") {
    return {
      at: item.at || new Date().toISOString(),
      type: "note",
      kind: "finding",
      text,
    };
  }
  if (item.type === "network" || item.type === "request") {
    return {
      at: item.at || new Date().toISOString(),
      type: "note",
      kind: item.status === null || item.status >= 400 ? "finding" : "context",
      text,
    };
  }
  if (item.type === "selection") {
    return {
      at: item.at || new Date().toISOString(),
      type: "note",
      kind: "finding",
      text,
    };
  }
  return {
    at: item.at || new Date().toISOString(),
    type: "note",
    kind: item.type === "decision" ? "decision" : "context",
    text,
  };
}

function renderSummary(model) {
  const lines = [];
  const consoleCount = model.events.filter((event) => event.type === "console" || event.type === "error").length;
  const failedNetworkCount = model.events.filter((event) => (event.type === "network" || event.type === "request") && (event.status === null || event.status >= 400)).length;
  const selectionCount = model.events.filter((event) => event.type === "selection" || event.selectedText).length;

  lines.push("# Browser Capture Evidence");
  lines.push("");
  lines.push(`- Source: ${model.sourcePath}`);
  lines.push(`- Captured at: ${cleanText(model.capture.capturedAt || "", model.helpers) || "unknown"}`);
  lines.push(`- Source app: ${cleanText(model.capture.source || "", model.helpers) || "unknown"}`);
  lines.push(`- Tabs: ${model.tabs.length}`);
  lines.push(`- Events: ${model.events.length}`);
  lines.push(`- Screenshots: ${model.screenshots.length}`);
  lines.push(`- Console errors: ${consoleCount}`);
  lines.push(`- Failed network requests: ${failedNetworkCount}`);
  lines.push(`- Text selections: ${selectionCount}`);
  lines.push("");
  lines.push("## Tabs");

  if (model.tabs.length === 0) {
    lines.push("- No browser tabs recorded.");
  } else {
    for (const tab of model.tabs) {
      const title = cleanText(tab.title || "", model.helpers) || "(untitled)";
      const url = cleanText(tab.url || "", model.helpers);
      lines.push(`- ${title}${url ? ` | ${url}` : ""}`);
    }
  }

  lines.push("");
  lines.push("## Timeline");
  if (model.events.length === 0) {
    lines.push("- No browser events recorded.");
  } else {
    for (const event of model.events) {
      lines.push(`- ${renderEventText(event)}`);
    }
  }

  return lines.join("\n");
}

function renderEventText(item) {
  const parts = [];
  if (item.at) {
    parts.push(item.at);
  }
  parts.push(item.type || "note");
  if (item.level) {
    parts.push(item.level);
  }
  if (item.title) {
    parts.push(item.title);
  }
  if (item.url) {
    parts.push(item.url);
  }
  if (item.method) {
    parts.push(item.method);
  }
  if (item.status !== null) {
    parts.push(`status ${item.status}`);
  }
  if (item.durationMs !== null && Number.isFinite(item.durationMs)) {
    parts.push(`${Math.round(item.durationMs)}ms`);
  }
  if (item.message) {
    parts.push(item.message);
  }
  if (item.selectedText) {
    parts.push(`selected: ${item.selectedText}`);
  }
  if (item.headings && item.headings.length > 0) {
    parts.push(`headings: ${item.headings.join(" | ")}`);
  }
  if (item.logText) {
    parts.push(`logs/details: ${item.logText}`);
  }
  if (item.pageText) {
    parts.push(`page text: ${item.pageText}`);
  }
  if (item.note) {
    parts.push(item.note);
  }
  return parts.join(" | ");
}

function cleanText(value, helpers) {
  return helpers.redactText(String(value || "").trim());
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = { importSessionData };
