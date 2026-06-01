#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const extensionDir = path.join(root, "browser-extension");
const distDir = path.join(root, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
const outputName = `tracepad-browser-extension-${manifest.version}.zip`;
const outputPath = path.join(distDir, outputName);
const packageFiles = [
  "README.md",
  "STORE_REVIEW.md",
  "content.js",
  "manifest.json",
  "page-hook.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "service_worker.js",
];

childProcess.execFileSync(process.execPath, [path.join(root, "scripts", "validate-extension.js")], { stdio: "inherit" });

fs.mkdirSync(distDir, { recursive: true });
if (fs.existsSync(outputPath)) {
  fs.rmSync(outputPath);
}

const zipCheck = childProcess.spawnSync("zip", ["--version"], { stdio: "ignore" });
if (zipCheck.error || zipCheck.status !== 0) {
  throw new Error("The `zip` command is required to package the browser extension.");
}

const result = childProcess.spawnSync("zip", ["-qr", outputPath, ...packageFiles], {
  cwd: extensionDir,
  stdio: "inherit",
});
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(`zip exited with status ${result.status}`);
}

process.stdout.write(`Packaged browser extension: ${outputPath}\n`);
