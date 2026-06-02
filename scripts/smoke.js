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
  run(["start", "Smoke browser incident", "--repo", tempRoot, "--context", "Smoke test session"]);
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

  run(["import", "browser-har", "--repo", tempRoot, "--file", harPath, "--note", "Smoke HAR"]);

  const exportPath = path.join(tempRoot, "handoff.md");
  run(["export", "--repo", tempRoot, "--template", "handoff", "--output", exportPath]);

  const status = run(["status", "--repo", tempRoot]);
  assert(status.includes("Events:"), "status output did not include event count");
  assert(fs.existsSync(exportPath), "handoff export was not created");

  const stopOutput = run(["stop", "--repo", tempRoot, "--summary", "Smoke session complete"]);
  assert(stopOutput.includes("Stopped session"), "stop output did not confirm the session stopped");
  assert(stopOutput.includes("Visual report:"), "stop output did not include visual report path");
  assert(findFiles(path.join(tempRoot, ".tracepad", "exports")).some((filePath) => filePath.endsWith(".html")), "stop did not create an HTML report");

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
