#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const extensionDir = path.join(root, "browser-extension");
const manifestPath = path.join(extensionDir, "manifest.json");

const requiredFiles = [
  "README.md",
  "STORE_REVIEW.md",
  "content.js",
  "icons/tracepad-icon.svg",
  "icons/tracepad-16.png",
  "icons/tracepad-32.png",
  "icons/tracepad-48.png",
  "icons/tracepad-128.png",
  "manifest.json",
  "page-hook.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "service_worker.js",
];

const allowedPermissions = new Set(["activeTab", "downloads", "scripting", "storage", "tabs", "webRequest"]);
const requiredCommands = new Set([
  "toggle-capture",
  "capture-selection",
  "capture-screenshot",
  "capture-page",
  "add-note",
  "export-capture",
  "clear-capture",
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const fileName of requiredFiles) {
  assert(fs.existsSync(path.join(extensionDir, fileName)), `Missing extension file: ${fileName}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert(manifest.manifest_version === 3, "Extension must use Manifest V3.");
assert(manifest.name === "Tracepad Browser Capture", "Unexpected extension name.");
assert(manifest.background && manifest.background.service_worker === "service_worker.js", "Missing service worker.");
assert(manifest.action && manifest.action.default_popup === "popup.html", "Missing popup.");

for (const size of ["16", "32", "48", "128"]) {
  const expectedPath = `icons/tracepad-${size}.png`;
  assert(manifest.icons && manifest.icons[size] === expectedPath, `Missing manifest icon: ${size}`);
  assert(
    manifest.action.default_icon && manifest.action.default_icon[size] === expectedPath,
    `Missing action icon: ${size}`,
  );
}

for (const permission of manifest.permissions || []) {
  assert(allowedPermissions.has(permission), `Unexpected permission: ${permission}`);
}

for (const command of requiredCommands) {
  assert(manifest.commands && manifest.commands[command], `Missing extension command: ${command}`);
  assert(manifest.commands[command].description, `Missing description for extension command: ${command}`);
}

const defaultShortcutCount = Object.values(manifest.commands || {}).filter((command) => command.suggested_key).length;
assert(defaultShortcutCount <= 4, "Chrome allows at most 4 default extension command shortcuts.");

for (const script of ["content.js", "page-hook.js", "popup.js", "service_worker.js"]) {
  childProcess.execFileSync(process.execPath, ["-c", path.join(extensionDir, script)], { stdio: "pipe" });
}

process.stdout.write("tracepad extension validation ok\n");
