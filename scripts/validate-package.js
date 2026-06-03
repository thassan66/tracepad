#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const requiredPackageFiles = [
  "CHANGELOG.md",
  "README.md",
  "LICENSE",
  "package.json",
  "bin/tracepad",
  "bin/tracepad.js",
  "schema/session.schema.json",
  "scripts/smoke.js",
  "scripts/validate-package.js",
  "docs/release-readiness.md",
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

const cliSource = fs.readFileSync(path.join(root, "bin", "tracepad.js"), "utf8");
assert(cliSource.includes(`const TOOL_VERSION = "${packageJson.version}"`), "CLI TOOL_VERSION must match package.json version.");

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

const packagedShape = fs.mkdtempSync(path.join(os.tmpdir(), "tracepad-package-shape-"));
try {
  fs.mkdirSync(path.join(packagedShape, "bin"), { recursive: true });
  fs.copyFileSync(path.join(root, "bin", "tracepad.js"), path.join(packagedShape, "bin", "tracepad.js"));
  const doctorOutput = childProcess.execFileSync(process.execPath, [path.join(packagedShape, "bin", "tracepad.js"), "doctor", "--repo", packagedShape], {
    cwd: packagedShape,
    encoding: "utf8",
  });
  assert(doctorOutput.includes("INFO Browser extension: optional"), "Packaged CLI doctor should not warn when extension source is not bundled.");
  assert(doctorOutput.includes("INFO Extension package: optional"), "Packaged CLI doctor should not warn when extension zip is not bundled.");
} finally {
  fs.rmSync(packagedShape, { recursive: true, force: true });
}

process.stdout.write("tracepad package validation ok\n");
