#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "bin", "tracepad.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tracepad-smoke-"));

function run(args, options = {}) {
  return childProcess.execFileSync(process.execPath, [cli, ...args], {
    cwd: options.cwd || tempRoot,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
}

function git(args) {
  childProcess.execFileSync("git", args, {
    cwd: tempRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  git(["init"]);
  run(["init", "--repo", tempRoot]);
  const doctorOutput = run(["doctor", "--repo", tempRoot]);
  assert(doctorOutput.includes("Tracepad Doctor"), "doctor output did not render the CLI doctor panel");
  assert(doctorOutput.includes("Node:"), "doctor output did not include Node status");
  assert(doctorOutput.includes("Git:"), "doctor output did not include Git status");
  assert(doctorOutput.includes("Repo store:"), "doctor output did not include repo store status");

  const startOutput = run(["start", "Smoke browser incident", "--repo", tempRoot, "--context", "Smoke test session"]);
  assert(startOutput.includes("Tracepad Session Started"), "start output did not render the CLI session panel");
  run(["note", "Observed checkout API failure", "--repo", tempRoot, "--kind", "finding"]);

  const harPath = path.join(tempRoot, "debug.har");
  fs.writeFileSync(
    harPath,
    JSON.stringify(
      {
        log: {
          version: "1.2",
          entries: [
            {
              startedDateTime: "2026-06-02T09:32:05.000Z",
              time: 842,
              request: {
                method: "GET",
                url: "https://api.example.local/payments/status?access_token=secret-token",
              },
              response: {
                status: 503,
                statusText: "Service Unavailable",
              },
            },
          ],
        },
      },
      null,
      2
    ),
    "utf8"
  );

  const browserCapturePath = path.join(tempRoot, "browser-capture.json");
  fs.writeFileSync(
    browserCapturePath,
    JSON.stringify(
      {
        version: 1,
        source: "tracepad-browser-extension",
        capturedAt: "2026-06-02T10:00:00.000Z",
        tabs: [
          {
            title: "Tracepad Smoke",
            url: "https://example.local/debug",
            capturedAt: "2026-06-02T10:00:01.000Z",
            selectedText: "HTTP 503 from checkout status",
            screenshot: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
          },
        ],
        events: [
          {
            type: "note",
            title: "Tracepad Smoke",
            url: "https://example.local/debug",
            message: "Contact john@example.com about https://internal.example.local/debug",
            at: "2026-06-02T10:00:01.500Z",
          },
          {
            type: "page",
            title: "Tracepad Smoke",
            url: "https://example.local/debug",
            message: "Captured visible CI/CD page details",
            pageText: "Checkout pipeline failed at deploy step",
            logText: "ERROR deploy checkout-api returned HTTP 503",
            headings: ["Checkout Pipeline", "Deploy Logs"],
            at: "2026-06-02T10:00:01.750Z",
          },
          {
            type: "network",
            method: "GET",
            url: "https://api.example.local/status?access_token=secret-token",
            status: 503,
            durationMs: 842,
            message: "HTTP request completed with an error status",
            at: "2026-06-02T10:00:02.000Z",
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  );

  run(["import", "browser-har", "--repo", tempRoot, "--file", harPath, "--note", "Smoke HAR"]);

  const previewPath = path.join(tempRoot, "browser-preview.html");
  const previewOutput = run(["view-browser", browserCapturePath, "--repo", tempRoot, "--output", previewPath, "--no-open"]);
  assert(previewOutput.includes("Browser capture preview imported"), "view-browser output did not confirm import");
  assert(previewOutput.includes("Browser Capture Preview"), "view-browser output did not render the CLI preview panel");
  assert(fs.existsSync(previewPath), "view-browser did not create an HTML preview");
  const previewHtml = fs.readFileSync(previewPath, "utf8");
  assert(previewHtml.includes("Review Workbench"), "view-browser preview did not render the review workbench");
  assert(previewHtml.includes("Share Pack"), "view-browser preview did not render share pack");
  assert(previewHtml.includes("PR Summary"), "view-browser preview did not render PR share card");
  assert(previewHtml.includes("Jira Issue"), "view-browser preview did not render Jira share card");
  assert(previewHtml.includes("Slack Update"), "view-browser preview did not render Slack share card");
  assert(previewHtml.includes("AI Handoff Prompt"), "view-browser preview did not render the AI handoff prompt");
  assert(previewHtml.includes("Priority Evidence"), "view-browser preview did not render priority evidence");
  assert(previewHtml.includes("Search timeline"), "view-browser preview did not render timeline search");
  assert(previewHtml.includes("copyTextById"), "view-browser preview did not include prompt copy controls");
  assert(previewHtml.includes("Browser Evidence Board"), "view-browser preview did not render browser evidence board");
  assert(previewHtml.includes("Suggested Insights"), "view-browser preview did not render suggested insights");
  assert(previewHtml.includes("timeline-controls"), "view-browser preview did not render timeline filters");
  assert(previewHtml.includes("[hidden] { display: none !important; }"), "timeline hidden state can be overridden by card display CSS");
  assert(previewHtml.includes('data-event-kinds="'), "timeline cards did not render filter categories");
  assert(previewHtml.includes("image-preview-button"), "HTML preview did not render clickable image previews");
  assert(previewHtml.includes("openImagePreview"), "HTML preview did not include image preview controls");
  assert(previewHtml.includes("Checkout pipeline failed at deploy step"), "page capture text did not render in the preview");
  assert(previewHtml.includes("ERROR deploy checkout-api returned HTTP 503"), "page capture log text did not render in the preview");

  const fullPreviewPath = path.join(tempRoot, "browser-preview-full.html");
  const fullPreviewOutput = run(["view-browser", browserCapturePath, "--repo", tempRoot, "--output", fullPreviewPath, "--no-open", "--redaction", "full"]);
  assert(fullPreviewOutput.includes("Redaction: full"), "full redaction preview did not report the selected redaction mode");
  const fullPreviewHtml = fs.readFileSync(fullPreviewPath, "utf8");
  assert(fullPreviewHtml.includes("Redaction full"), "full redaction report did not show the redaction mode");
  assert(fullPreviewHtml.includes("[REDACTED_EMAIL]"), "full redaction did not redact email text");
  assert(fullPreviewHtml.includes("[REDACTED_URL]"), "full redaction did not redact URL text");
  assert(fullPreviewHtml.includes("Image preview hidden by full redaction mode"), "full redaction did not hide image previews");
  assert(!fullPreviewHtml.includes("john@example.com"), "full redaction leaked email text");
  assert(!fullPreviewHtml.includes("internal.example.local"), "full redaction leaked internal URL text");

  const exportPath = path.join(tempRoot, "handoff.md");
  run(["export", "--repo", tempRoot, "--template", "handoff", "--output", exportPath]);

  const status = run(["status", "--repo", tempRoot]);
  assert(status.includes("Tracepad Status"), "status output did not render the CLI status panel");
  assert(status.includes("Events:"), "status output did not include event count");
  assert(fs.existsSync(exportPath), "handoff export was not created");

  const stopOutput = run(["stop", "--repo", tempRoot, "--summary", "Smoke session complete"]);
  assert(stopOutput.includes("Tracepad Session Complete"), "stop output did not render the CLI completion panel");
  assert(stopOutput.includes("Stopped session"), "stop output did not confirm the session stopped");
  assert(stopOutput.includes("Final evidence:"), "stop output did not summarize final evidence capture");
  assert(stopOutput.includes("Visual report:"), "stop output did not include visual report path");
  assert(findFiles(path.join(tempRoot, ".tracepad", "exports")).some((filePath) => filePath.endsWith(".html")), "stop did not create an HTML report");

  const reviewPath = path.join(tempRoot, "latest-review.html");
  const reviewOutput = run(["review", "--repo", tempRoot, "--output", reviewPath, "--no-open"]);
  assert(reviewOutput.includes("Tracepad Review Dashboard"), "review output did not render the CLI review panel");
  assert(reviewOutput.includes("Visual report:"), "review output did not include the report path");
  assert(fs.existsSync(reviewPath), "review did not create an HTML dashboard");
  const reviewHtml = fs.readFileSync(reviewPath, "utf8");
  assert(reviewHtml.includes("Review Workbench"), "review dashboard did not include the review workbench");
  assert(reviewHtml.includes("Share Pack"), "review dashboard did not include the share pack");
  assert(reviewHtml.includes("AI Handoff Prompt"), "review dashboard did not include the AI handoff prompt");
  assert(reviewHtml.includes("Search timeline"), "review dashboard did not include timeline search");

  const openReportOutput = run(["open", "--repo", tempRoot, "--latest-report", "--no-open"]);
  assert(openReportOutput.includes("Tracepad Open"), "open report did not render the CLI open panel");
  assert(openReportOutput.includes("Latest visual report"), "open report did not target the latest visual report");
  const openSessionOutput = run(["open", "--repo", tempRoot, "--latest-session", "--no-open"]);
  assert(openSessionOutput.includes("Latest session JSON"), "open session did not target the latest session JSON");
  const openScreenshotOutput = run(["open", "--repo", tempRoot, "--latest-screenshot", "--no-open"]);
  assert(openScreenshotOutput.includes("Latest screenshot artifact"), "open screenshot did not target the latest screenshot artifact");

  const prShare = run(["share", "--repo", tempRoot, "--format", "pr"]);
  assert(prShare.includes("## Summary"), "PR share output did not include summary section");
  assert(prShare.includes("## Debug Evidence"), "PR share output did not include evidence section");
  const slackShare = run(["share", "slack", "--repo", tempRoot]);
  assert(slackShare.includes("*Tracepad update:*"), "Slack share output did not include Slack update heading");
  const aiSharePath = path.join(tempRoot, "ai-share.md");
  const aiShareOutput = run(["share", "--repo", tempRoot, "--format", "ai", "--redaction", "full", "--output", aiSharePath]);
  assert(aiShareOutput.includes("Shared ai handoff"), "AI share output did not confirm file write");
  assert(fs.existsSync(aiSharePath), "AI share output file was not created");
  assert(fs.readFileSync(aiSharePath, "utf8").includes("You are reviewing a local Tracepad debugging session"), "AI share file did not include the handoff prompt");

  const recordPath = path.join(tempRoot, "record-review.html");
  const recordOutput = run([
    "record",
    "Scripted recorder smoke",
    "--repo",
    tempRoot,
    "--command",
    `${process.execPath} -e "process.exit(0)"`,
    "--output",
    recordPath,
    "--no-open",
  ]);
  assert(recordOutput.includes("Recording session"), "record did not start a recording session");
  assert(recordOutput.includes("Tracepad Session Complete"), "record did not close with the completion panel");
  assert(recordOutput.includes("Final evidence:"), "record did not summarize final evidence");
  assert(fs.existsSync(recordPath), "record did not create a visual dashboard");
  const recordHtml = fs.readFileSync(recordPath, "utf8");
  assert(recordHtml.includes("Scripted recorder smoke"), "record dashboard did not include the session title");
  assert(recordHtml.includes("process.exit(0)"), "record dashboard did not include the recorded command");

  const generatedCapture = path.join(tempRoot, "tracepad-browser-capture-smoke.json");
  fs.writeFileSync(generatedCapture, JSON.stringify({ source: "tracepad-browser-extension" }), "utf8");
  const cleanDryRunOutput = run(["clean", "--repo", tempRoot, "--browser-captures", "--dry-run"]);
  assert(cleanDryRunOutput.includes("Tracepad Clean"), "clean dry-run did not render the CLI clean panel");
  assert(cleanDryRunOutput.includes("Would remove"), "clean dry-run did not preview matching files");
  assert(fs.existsSync(generatedCapture), "clean dry-run removed a browser capture file");
  const cleanDeleteOutput = run(["clean", "--repo", tempRoot, "--browser-captures", "--yes"]);
  assert(cleanDeleteOutput.includes("Cleanup complete"), "clean delete did not confirm cleanup");
  assert(!fs.existsSync(generatedCapture), "clean delete did not remove the generated browser capture file");
  const cleanExportsDryRunOutput = run(["clean", "--repo", tempRoot, "--exports", "--dry-run"]);
  assert(cleanExportsDryRunOutput.includes("export:"), "clean exports dry-run did not include export files");

  const tracepadText = readAllText(path.join(tempRoot, ".tracepad"));
  assert(tracepadText.includes("access_token=[REDACTED]"), "expected redacted access_token in Tracepad store");
  assert(!tracepadText.includes("secret-token"), "secret token was stored without redaction");

  process.stdout.write("tracepad smoke ok\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function readAllText(dir) {
  const chunks = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const itemPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      chunks.push(readAllText(itemPath));
    } else if (entry.isFile()) {
      chunks.push(fs.readFileSync(itemPath, "utf8"));
    }
  }
  return chunks.join("\n");
}

function findFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const itemPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findFiles(itemPath));
    } else if (entry.isFile()) {
      files.push(itemPath);
    }
  }
  return files;
}
