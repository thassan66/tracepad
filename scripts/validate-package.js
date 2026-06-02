#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const requiredPackageFiles = [
  "README.md",
  "LICENSE",
  "package.json",
  "bin/tracepad",
  "bin/tracepad.js",
  "schema/session.schema.json",
  "scripts/smoke.js",
  "scripts/validate-package.js",
  "src/plugins/importers/browser-capture.js",
  "src/plugins/importers/browser-har.js",
  "src/plugins/importers/plain-log.js",
  "src/plugins/exporters/slack.js",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(packageJson.name === "tracepad", "Unexpected package name.");
assert(packageJson.version, "Package version is required.");
assert(packageJson.bin && packageJson.bin.tracepad === "./bin/tracepad", "tracepad bin must point to ./bin/tracepad.");
assert(packageJson.engines && packageJson.engines.node, "Node engine range is required.");

const binPath = path.join(root, packageJson.bin.tracepad);
assert(fs.existsSync(binPath), "Package bin target is missing.");
assert(fs.statSync(binPath).mode & 0o111, "Package bin target must be executable.");

const helpOutput = childProcess.execFileSync(process.execPath, [path.join(root, "bin", "tracepad.js"), "--help"], {
  cwd: root,
  encoding: "utf8",
});
assert(helpOutput.includes("tracepad quickstart"), "CLI help should mention quickstart.");

const quickstartOutput = childProcess.execFileSync(process.execPath, [path.join(root, "bin", "tracepad.js"), "quickstart"], {
  cwd: root,
  encoding: "utf8",
});
assert(quickstartOutput.includes("Tracepad Quickstart"), "quickstart command did not render.");

const packJson = childProcess.execFileSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const packResult = JSON.parse(packJson)[0];
assert(packResult && Array.isArray(packResult.files), "npm pack dry-run did not return package files.");

const packageFiles = new Set(packResult.files.map((item) => item.path));
for (const filePath of requiredPackageFiles) {
  assert(packageFiles.has(filePath), `Package is missing required file: ${filePath}`);
}

for (const item of packageFiles) {
  assert(!item.startsWith(".tracepad/"), "Package must not include local .tracepad data.");
  assert(!/^examples\/browser-capture\/tracepad-browser-capture-.*\.json$/.test(item), "Package must not include generated browser captures.");
}

process.stdout.write("tracepad package validation ok\n");
