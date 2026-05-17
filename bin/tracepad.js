#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const TOOL_NAME = "Tracepad";
const TOOL_VERSION = "0.3.0";
const NOTE_KINDS = new Set(["note", "finding", "hypothesis", "decision", "blocker", "context"]);
const EXPORT_TEMPLATES = new Set(["handoff", "issue", "pr", "postmortem"]);
const EXPORT_FORMATS = new Set(["markdown", "html"]);
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgv(argv);
  const command = parsed.command;
  const flags = parsed.flags;
  const args = parsed.positionals;

  if (!command || flags.help) {
    process.stdout.write(renderHelp());
    return;
  }

  const repoRoot = path.resolve(flags.repo || process.cwd());

  switch (command) {
    case "init":
      handleInit(repoRoot);
      return;
    case "start":
      handleStart(repoRoot, args, flags);
      return;
    case "record":
      await handleRecord(repoRoot, args, flags);
      return;
    case "use":
      handleUse(repoRoot, args);
      return;
    case "list":
      handleList(repoRoot);
      return;
    case "status":
      handleStatus(repoRoot, args, flags);
      return;
    case "tui":
      await handleTui(repoRoot, args, flags);
      return;
    case "note":
      handleNote(repoRoot, args, flags);
      return;
    case "cmd":
      handleCommandEvent(repoRoot, args, flags);
      return;
    case "history":
      handleHistoryImport(repoRoot, flags);
      return;
    case "diff":
      handleDiffSnapshot(repoRoot, flags);
      return;
    case "capture":
      await handleCapture(repoRoot, flags);
      return;
    case "attach":
      handleAttach(repoRoot, args, flags);
      return;
    case "close":
      handleClose(repoRoot, args, flags);
      return;
    case "export":
      handleExport(repoRoot, args, flags);
      return;
    case "help":
      process.stdout.write(renderHelp());
      return;
    default:
      fail(`Unknown command: ${command}`);
  }
}

function parseArgv(argv) {
  if (argv.length === 0) {
    return { command: null, flags: {}, positionals: [] };
  }

  let command = null;
  let index = 0;
  if (!argv[0].startsWith("--")) {
    command = argv[0];
    index = 1;
  }

  const flags = {};
  const positionals = [];

  for (; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) {
      positionals.push(part);
      continue;
    }

    if (part.includes("=")) {
      const [rawKey, ...rest] = part.slice(2).split("=");
      flags[rawKey] = rest.join("=");
      continue;
    }

    const key = part.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { command, flags, positionals };
}

function handleInit(repoRoot) {
  ensureStore(repoRoot);
  process.stdout.write(`${TOOL_NAME} store ready at ${storeDir(repoRoot)}\n`);
}

function handleStart(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = createSession(repoRoot, args, flags);
  writeSession(repoRoot, session);
  setActiveSessionId(repoRoot, session.id);
  process.stdout.write(`Started session ${session.id}: ${session.title}\n`);
}

async function handleRecord(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = createSession(repoRoot, args, flags);
  writeSession(repoRoot, session);
  setActiveSessionId(repoRoot, session.id);

  const captured = [];
  if (!flags["no-status-snapshot"]) {
    const statusResult = captureGitStatusSnapshot(repoRoot, session, "Session baseline");
    if (statusResult.captured) {
      captured.push("git status");
    }
  }

  if (!flags["no-history"]) {
    const historyResult = importHistoryIntoSession(repoRoot, session, {
      shell: flags.shell,
      file: flags.file,
      limit: flags["history-limit"] !== undefined ? Number(flags["history-limit"]) : 12,
      silent: true,
    });
    if (historyResult.imported > 0) {
      captured.push(`${historyResult.imported} history cmd(s)`);
    }
  }

  writeSession(repoRoot, session);
  process.stdout.write(`Recording session ${session.id}: ${session.title}\n`);
  if (captured.length > 0) {
    process.stdout.write(`Bootstrapped with ${captured.join(", ")}\n`);
  }
  await handleCapture(repoRoot, { session: session.id });
}

function handleUse(repoRoot, args) {
  ensureStore(repoRoot);
  const sessionId = firstArg(args);
  if (!sessionId) {
    fail("Usage: tracepad use <session-id>");
  }

  const session = readSession(repoRoot, sessionId);
  setActiveSessionId(repoRoot, session.id);
  process.stdout.write(`Active session set to ${session.id}: ${session.title}\n`);
}

function handleList(repoRoot) {
  ensureStore(repoRoot);
  const sessions = listSessions(repoRoot).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const activeId = getState(repoRoot).activeSessionId;

  if (sessions.length === 0) {
    process.stdout.write("No Tracepad sessions yet.\n");
    return;
  }

  const lines = [];
  lines.push(`${TOOL_NAME} sessions`);
  for (const session of sessions) {
    const marker = session.id === activeId ? "*" : " ";
    const summary = summarizeSession(session);
    lines.push(
      `${marker} ${session.id} | ${session.status} | ${session.updatedAt} | ${session.title} | ${summary.noteCount} notes | ${summary.commandCount} cmds`
    );
  }
  lines.push("");
  process.stdout.write(`${lines.join("\n")}\n`);
}

function handleStatus(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: true });
  const summary = summarizeSession(session);
  const lines = [];

  lines.push(`${TOOL_NAME}`);
  lines.push(`Session: ${session.id}`);
  lines.push(`Title: ${session.title}`);
  lines.push(`Status: ${session.status}`);
  lines.push(`Created: ${session.createdAt}`);
  lines.push(`Updated: ${session.updatedAt}`);
  if (session.branch) {
    lines.push(`Branch: ${session.branch}`);
  }
  lines.push(`Events: ${session.events.length}`);
  lines.push(`Notes: ${summary.noteCount}`);
  lines.push(`Commands: ${summary.commandCount}`);
  lines.push(`Attachments: ${summary.attachmentCount}`);
  lines.push(`Snapshots: ${summary.snapshotCount}`);
  lines.push(`Failing cmds: ${summary.failingCommandCount}`);
  lines.push(`Decisions: ${summary.decisionCount}`);
  if (session.summary) {
    lines.push(`Summary: ${session.summary}`);
  }
  lines.push("");
  lines.push("Recent timeline:");

  const recentEvents = session.events.slice(-8);
  if (recentEvents.length === 0) {
    lines.push("  - none");
  } else {
    for (const event of recentEvents) {
      lines.push(`  - ${renderEventLine(event)}`);
    }
  }

  lines.push("");
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function handleTui(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: true });

  if (!process.stdout.isTTY || !process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    handleStatus(repoRoot, args, flags);
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const rerender = () => {
    const fresh = readSession(repoRoot, session.id);
    process.stdout.write(renderTuiScreen(fresh));
  };

  rerender();

  await new Promise((resolve) => {
    const onKeypress = (str, key) => {
      if (!key) {
        return;
      }
      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        cleanup();
        resolve();
        return;
      }
      if (key.name === "r") {
        rerender();
        return;
      }
      if (key.name === "e") {
        const outputPath = defaultExportPath(repoRoot, session.id, "html");
        const fresh = readSession(repoRoot, session.id);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${renderExport(fresh, { format: "html", template: "handoff" })}\n`, "utf8");
        process.stdout.write(renderTuiScreen(fresh, `Exported HTML to ${outputPath}`));
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdout.write("\x1b[0m\x1b[?25h");
    };

    process.stdin.on("keypress", onKeypress);
  });
}

function handleNote(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: false });
  const text = joinArgs(args);
  if (!text) {
    fail("Usage: tracepad note \"what you found\" [--kind finding|hypothesis|decision|blocker|context]");
  }

  const kind = normalizeNoteKind(flags.kind);
  session.events.push(createEvent("note", { text, kind }));
  touchSession(session);
  writeSession(repoRoot, session);
  process.stdout.write(`Added ${kind} note to ${session.id}\n`);
}

function handleCommandEvent(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: false });
  const commandText = joinArgs(args);
  if (!commandText) {
    fail("Usage: tracepad cmd \"mvn test -Dtest=FooTest\" [--exit-code 1] [--note \"what happened\"]");
  }

  const exitCode = flags["exit-code"] !== undefined ? Number(flags["exit-code"]) : null;
  const note = flags.note ? String(flags.note).trim() : "";
  session.events.push(
    createEvent("command", {
      command: commandText,
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      note,
      source: "manual",
    })
  );
  touchSession(session);
  writeSession(repoRoot, session);
  process.stdout.write(`Recorded command in ${session.id}\n`);
}

function handleHistoryImport(repoRoot, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, [], flags, { allowPositionalId: false });
  const result = importHistoryIntoSession(repoRoot, session, {
    shell: flags.shell,
    file: flags.file,
    limit: flags.limit !== undefined ? Number(flags.limit) : 20,
    silent: false,
  });
  if (result.imported > 0) {
    writeSession(repoRoot, session);
  }
}

function importHistoryIntoSession(repoRoot, session, options) {
  const limit = options.limit !== undefined ? Number(options.limit) : 20;
  if (!Number.isFinite(limit) || limit <= 0) {
    fail("Invalid --limit value for history import");
  }

  const shell = determineShellName(options.shell);
  const historyFile = resolveHistoryFile(options.file, shell);
  if (!historyFile || !fs.existsSync(historyFile)) {
    if (options.silent) {
      return { imported: 0 };
    }
    fail(`History file not found for shell ${shell}${historyFile ? `: ${historyFile}` : ""}`);
  }

  const commands = readShellHistory(historyFile, shell).filter(Boolean);
  const recent = commands.slice(-limit);
  if (recent.length === 0) {
    if (!options.silent) {
      process.stdout.write("No shell history entries found to import.\n");
    }
    return { imported: 0 };
  }

  for (const command of recent) {
    session.events.push(
      createEvent("command", {
        command,
        exitCode: null,
        note: `Imported from ${shell} history`,
        source: "history",
      })
    );
  }

  touchSession(session);
  if (!options.silent) {
    process.stdout.write(`Imported ${recent.length} command(s) from ${historyFile} into ${session.id}\n`);
  }
  return { imported: recent.length, historyFile };
}

function handleDiffSnapshot(repoRoot, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, [], flags, { allowPositionalId: false });
  const staged = Boolean(flags.staged);
  const diffArgs = staged ? ["diff", "--staged", "--no-color"] : ["diff", "--no-color"];
  const git = runGit(repoRoot, diffArgs);

  if (git.error) {
    fail(`Could not capture git diff: ${git.error}`);
  }

  const diffText = git.output;
  if (!diffText.trim()) {
    process.stdout.write("No git diff output to capture.\n");
    return;
  }

  const relativeStoredPath = storeArtifactText(repoRoot, session.id, diffText, `${staged ? "staged" : "working-tree"}-diff.patch`);
  const changedFiles = countChangedFiles(diffText);
  session.events.push(
    createEvent("snapshot", {
      snapshotKind: staged ? "git-diff-staged" : "git-diff",
      storedPath: relativeStoredPath,
      changedFiles,
      note: flags.note ? String(flags.note).trim() : "",
    })
  );
  touchSession(session);
  writeSession(repoRoot, session);
  process.stdout.write(`Captured git diff snapshot to ${relativeStoredPath}\n`);
}

function captureGitStatusSnapshot(repoRoot, session, note) {
  const git = runGit(repoRoot, ["status", "--short", "--branch"]);
  if (git.error) {
    return { captured: false, error: git.error };
  }

  const output = git.output.trim();
  if (!output) {
    return { captured: false };
  }

  const relativeStoredPath = storeArtifactText(repoRoot, session.id, `${output}\n`, "git-status.txt");
  const changedFiles = output
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("##"))
    .length;
  session.events.push(
    createEvent("snapshot", {
      snapshotKind: "git-status",
      storedPath: relativeStoredPath,
      changedFiles,
      note: note || "",
    })
  );
  touchSession(session);
  return { captured: true, path: relativeStoredPath };
}

async function handleCapture(repoRoot, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, [], flags, { allowPositionalId: false });

  process.stdout.write(`${TOOL_NAME} capture for ${session.id}: ${session.title}\n`);
  process.stdout.write("Commands: note, finding, hypothesis, decision, blocker, cmd, attach, diff, status, export, tui, quit\n");

  if (!process.stdin.isTTY) {
    const input = fs.readFileSync(0, "utf8");
    const lines = input.split(/\r?\n/);
    for (const rawLine of lines) {
      const shouldContinue = await processCaptureLine(repoRoot, session.id, rawLine);
      if (!shouldContinue) {
        process.stdout.write("Leaving capture mode.\n");
        return;
      }
    }
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const line = await ask(rl, "tracepad> ");
      const shouldContinue = await processCaptureLine(repoRoot, session.id, line);
      if (!shouldContinue) {
        process.stdout.write("Leaving capture mode.\n");
        break;
      }
    }
  } finally {
    rl.close();
  }
}

async function processCaptureLine(repoRoot, sessionId, rawLine) {
  const line = String(rawLine || "").trim();
  if (!line) {
    return true;
  }

  if (line === "quit" || line === "exit" || line === "q") {
    return false;
  }

  if (line === "help") {
    process.stdout.write("note <text> | finding <text> | hypothesis <text> | decision <text> | blocker <text> | cmd <command> | attach <path> | diff | status | export | tui | quit\n");
    return true;
  }

  if (line === "status") {
    handleStatus(repoRoot, [], { session: sessionId });
    return true;
  }

  if (line === "diff") {
    handleDiffSnapshot(repoRoot, { session: sessionId });
    return true;
  }

  if (line === "tui") {
    await handleTui(repoRoot, [], { session: sessionId });
    return true;
  }

  if (line === "export") {
    const outputPath = defaultExportPath(repoRoot, sessionId, "html");
    const session = readSession(repoRoot, sessionId);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${renderExport(session, { format: "html", template: "handoff" })}\n`, "utf8");
    process.stdout.write(`Exported HTML to ${outputPath}\n`);
    return true;
  }

  if (line.startsWith("attach ")) {
    handleAttach(repoRoot, [line.slice(7).trim()], { session: sessionId });
    return true;
  }

  if (line.startsWith("cmd ")) {
    handleCommandEvent(repoRoot, [line.slice(4).trim()], { session: sessionId });
    return true;
  }

  const firstSpace = line.indexOf(" ");
  const verb = firstSpace === -1 ? line : line.slice(0, firstSpace);
  const payload = firstSpace === -1 ? "" : line.slice(firstSpace + 1).trim();

  if (NOTE_KINDS.has(verb)) {
    if (!payload) {
      process.stdout.write("Text is required for note capture.\n");
      return true;
    }
    handleNote(repoRoot, [payload], { session: sessionId, kind: verb });
    return true;
  }

  process.stdout.write("Unknown capture command. Type help for available commands.\n");
  return true;
}

function handleAttach(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: false });
  const sourceArg = firstArg(args);
  if (!sourceArg) {
    fail("Usage: tracepad attach <path-to-file> [--note \"why it matters\"]");
  }

  const sourcePath = path.isAbsolute(sourceArg) ? sourceArg : path.resolve(repoRoot, sourceArg);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    fail(`Attachment not found or not a file: ${sourcePath}`);
  }

  const targetPath = createArtifactPath(repoRoot, session.id, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, targetPath);

  const note = flags.note ? String(flags.note).trim() : "";
  const relativeStoredPath = path.relative(repoRoot, targetPath).replace(/\\/g, "/");
  session.events.push(
    createEvent("attachment", {
      originalPath: sourcePath,
      storedPath: relativeStoredPath,
      note,
    })
  );
  touchSession(session);
  writeSession(repoRoot, session);
  process.stdout.write(`Attached ${sourcePath} to ${session.id}\n`);
}

function handleClose(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: false });
  const summary = flags.summary ? String(flags.summary).trim() : joinArgs(args);

  if (summary) {
    session.summary = summary;
  }

  session.status = "closed";
  session.events.push(
    createEvent("status", {
      state: "closed",
      note: summary || "",
    })
  );
  touchSession(session);
  writeSession(repoRoot, session);

  const state = getState(repoRoot);
  if (state.activeSessionId === session.id) {
    state.activeSessionId = null;
    writeState(repoRoot, state);
  }

  process.stdout.write(`Closed session ${session.id}\n`);
}

function handleExport(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: true });
  const template = normalizeTemplate(flags.template);
  const format = normalizeFormat(flags.format, flags.output);
  const output = renderExport(session, { format, template });
  const outputPath = flags.output ? path.resolve(String(flags.output)) : null;

  if (!outputPath) {
    process.stdout.write(`${output}\n`);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${output}\n`, "utf8");
  process.stdout.write(`Exported session ${session.id} to ${outputPath}\n`);
}

function renderExport(session, options) {
  const template = normalizeTemplate(options.template);
  const format = normalizeFormat(options.format);

  if (format === "html") {
    return renderHtmlTemplate(session, template);
  }

  return renderMarkdownTemplate(session, template);
}

function renderMarkdownTemplate(session, template) {
  if (template === "issue") {
    return renderIssueMarkdown(session);
  }
  if (template === "pr") {
    return renderPrMarkdown(session);
  }
  if (template === "postmortem") {
    return renderPostmortemMarkdown(session);
  }
  return renderHandoffMarkdown(session);
}

function renderHandoffMarkdown(session) {
  const model = buildSessionModel(session);
  const lines = [];
  lines.push(`# ${session.title}`);
  lines.push("");
  lines.push(`- Session ID: ${session.id}`);
  lines.push(`- Status: ${session.status}`);
  lines.push(`- Branch: ${session.branch || "unknown"}`);
  lines.push(`- Started by: ${session.startedBy}`);
  lines.push(`- Created: ${session.createdAt}`);
  lines.push(`- Updated: ${session.updatedAt}`);
  lines.push("");
  lines.push("## Executive Summary");
  lines.push(session.summary || model.summaryFallback);
  lines.push("");
  lines.push("## What We Know");
  appendLines(lines, model.byKind.finding.length > 0 ? model.byKind.finding.map((item) => `- ${item.text}`) : ["- No findings recorded yet."]);
  lines.push("");
  lines.push("## Hypotheses");
  appendLines(lines, model.byKind.hypothesis.length > 0 ? model.byKind.hypothesis.map((item) => `- ${item.text}`) : ["- No hypotheses recorded yet."]);
  lines.push("");
  lines.push("## Timeline");
  appendLines(lines, model.timelineLines);
  lines.push("");
  lines.push("## Evidence");
  appendLines(lines, model.evidenceLines);
  lines.push("");
  return lines.join("\n").trimEnd();
}

function renderIssueMarkdown(session) {
  const model = buildSessionModel(session);
  const lines = [];
  lines.push(`# Bug: ${session.title}`);
  lines.push("");
  lines.push("## Observed Behavior");
  appendLines(lines, model.byKind.finding.length > 0 ? model.byKind.finding.map((item) => `- ${item.text}`) : ["- Add observed behavior here."]);
  lines.push("");
  lines.push("## Suspected Cause");
  appendLines(lines, model.byKind.hypothesis.length > 0 ? model.byKind.hypothesis.map((item) => `- ${item.text}`) : ["- Not confirmed yet."]);
  lines.push("");
  lines.push("## Reproduction Trail");
  appendLines(lines, model.commands.length > 0 ? model.commands.slice(0, 8).map((item) => `- \`${item.command}\`${renderExitText(item)}`) : ["- No commands recorded yet."]);
  lines.push("");
  lines.push("## Evidence");
  appendLines(lines, model.evidenceLines);
  lines.push("");
  return lines.join("\n").trimEnd();
}

function renderPrMarkdown(session) {
  const model = buildSessionModel(session);
  const lines = [];
  lines.push(`# PR Debug Brief: ${session.title}`);
  lines.push("");
  lines.push("## What Changed");
  appendLines(lines, model.snapshots.length > 0 ? model.snapshots.map((item) => `- ${item.snapshotKind}: ${item.storedPath}${item.note ? ` - ${item.note}` : ""}`) : ["- No snapshots recorded yet."]);
  lines.push("");
  lines.push("## Why");
  appendLines(lines, model.byKind.decision.length > 0 ? model.byKind.decision.map((item) => `- ${item.text}`) : ["- No explicit decisions captured yet."]);
  lines.push("");
  lines.push("## Verification");
  appendLines(lines, model.commands.length > 0 ? model.commands.map((item) => `- \`${item.command}\`${renderExitText(item)}${item.note ? ` - ${item.note}` : ""}`) : ["- No verification commands recorded yet."]);
  lines.push("");
  lines.push("## Risk Notes");
  appendLines(lines, model.byKind.blocker.length > 0 ? model.byKind.blocker.map((item) => `- ${item.text}`) : ["- No blockers recorded."]);
  lines.push("");
  return lines.join("\n").trimEnd();
}

function renderPostmortemMarkdown(session) {
  const model = buildSessionModel(session);
  const lines = [];
  lines.push(`# Postmortem Draft: ${session.title}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(session.summary || model.summaryFallback);
  lines.push("");
  lines.push("## Timeline");
  appendLines(lines, model.timelineLines);
  lines.push("");
  lines.push("## Root Cause Signals");
  appendLines(lines, model.byKind.finding.concat(model.byKind.hypothesis).map((item) => `- [${item.kind}] ${item.text}`));
  lines.push("");
  lines.push("## Decisions and Mitigations");
  appendLines(lines, model.byKind.decision.length > 0 ? model.byKind.decision.map((item) => `- ${item.text}`) : ["- No decisions recorded yet."]);
  lines.push("");
  lines.push("## Evidence");
  appendLines(lines, model.evidenceLines);
  lines.push("");
  return lines.join("\n").trimEnd();
}

function renderHtmlTemplate(session, template) {
  const model = buildSessionModel(session);
  const titleMap = {
    handoff: "Debugging Flight Recorder",
    issue: "Issue Brief",
    pr: "PR Debug Brief",
    postmortem: "Postmortem Draft",
  };
  const body = [
    renderHtmlHero(session, titleMap[template]),
    renderHtmlMetrics(model),
    renderHtmlSection("Summary", [escapeHtml(session.summary || model.summaryFallback)]),
    renderHtmlSection("Findings", model.byKind.finding.map((item) => escapeHtml(item.text)), "No findings captured yet."),
    renderHtmlSection("Hypotheses", model.byKind.hypothesis.map((item) => escapeHtml(item.text)), "No hypotheses captured yet."),
    renderHtmlSection("Commands", model.commands.map((item) => `<code>${escapeHtml(item.command)}</code>${escapeHtml(renderExitText(item))}${item.note ? ` <span class="muted">- ${escapeHtml(item.note)}</span>` : ""}`), "No commands captured yet."),
    renderHtmlSection("Snapshots", model.snapshots.map((item) => `${escapeHtml(item.snapshotKind)} - <code>${escapeHtml(item.storedPath)}</code>${item.note ? ` <span class="muted">- ${escapeHtml(item.note)}</span>` : ""}`), "No snapshots captured yet."),
    renderHtmlSection("Timeline", model.timelineLines.map((line) => escapeHtml(line)), "No timeline captured yet."),
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(session.title)} - ${TOOL_NAME}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1015;
      --panel: #121b24;
      --panel-alt: #182432;
      --line: #293648;
      --text: #ebf1f7;
      --muted: #95a5b8;
      --cyan: #56d6ff;
      --green: #62d394;
      --yellow: #ffcf70;
      --rose: #ff8798;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, Segoe UI, Arial, sans-serif;
      background:
        radial-gradient(circle at top left, rgba(86, 214, 255, 0.12), transparent 20%),
        radial-gradient(circle at top right, rgba(98, 211, 148, 0.10), transparent 18%),
        var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .shell {
      width: min(1100px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 24px 0 40px;
    }
    .hero, .section, .metric {
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: 0 18px 38px rgba(0,0,0,0.22);
    }
    .hero { padding: 22px; margin-bottom: 18px; }
    .hero h1 { margin: 0 0 8px; font-size: 2rem; }
    .eyebrow { margin: 0 0 10px; color: var(--cyan); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.08em; }
    .meta { display: flex; gap: 16px; flex-wrap: wrap; color: var(--muted); }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; margin-bottom: 18px; }
    .metric { padding: 16px; }
    .metric strong { display: block; font-size: 1.5rem; }
    .metric span { color: var(--muted); font-size: 0.85rem; }
    .sections { display: grid; gap: 16px; }
    .section { padding: 18px; }
    .section h2 { margin: 0 0 12px; font-size: 1rem; }
    ul { margin: 0; padding-left: 20px; }
    li + li { margin-top: 8px; }
    code {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 6px;
      padding: 2px 6px;
      font-family: Consolas, Menlo, monospace;
      font-size: 0.92em;
    }
    .muted { color: var(--muted); }
    @media (max-width: 760px) {
      .metrics { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .hero h1 { font-size: 1.55rem; }
    }
  </style>
</head>
<body>
  <main class="shell">
    ${body}
  </main>
</body>
</html>`;
}

function renderHtmlHero(session, label) {
  return `<section class="hero">
    <p class="eyebrow">${escapeHtml(label)}</p>
    <h1>${escapeHtml(session.title)}</h1>
    <div class="meta">
      <span>Session ${escapeHtml(session.id)}</span>
      <span>Status: ${escapeHtml(session.status)}</span>
      <span>Branch: ${escapeHtml(session.branch || "unknown")}</span>
      <span>Updated: ${escapeHtml(session.updatedAt)}</span>
    </div>
  </section>`;
}

function renderHtmlMetrics(model) {
  const metrics = [
    { value: model.summary.noteCount, label: "Notes" },
    { value: model.summary.commandCount, label: "Commands" },
    { value: model.summary.snapshotCount, label: "Snapshots" },
    { value: model.summary.failingCommandCount, label: "Failing Commands" },
  ];
  return `<section class="metrics">
    ${metrics
      .map(
        (item) => `<article class="metric"><strong>${escapeHtml(String(item.value))}</strong><span>${escapeHtml(item.label)}</span></article>`
      )
      .join("")}
  </section>`;
}

function renderHtmlSection(title, lines, emptyText) {
  const content = lines.length > 0 ? `<ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul>` : `<p class="muted">${escapeHtml(emptyText || "No data.")}</p>`;
  return `<section class="section"><h2>${escapeHtml(title)}</h2>${content}</section>`;
}

function renderTuiScreen(session, flashMessage) {
  const summary = summarizeSession(session);
  const width = Math.max(72, Math.min(process.stdout.columns || 120, 120));
  const innerWidth = width - 4;
  const timelineLines = session.events.slice(-8).map(renderEventLine);

  const left = [
    `${ANSI.cyan}${ANSI.bold}Tracepad${ANSI.reset} ${ANSI.gray}debugging flight recorder${ANSI.reset}`,
    `${ANSI.bold}${session.title}${ANSI.reset}`,
    `${ANSI.gray}Session ${session.id} | ${session.status} | ${session.branch || "no-branch"}${ANSI.reset}`,
  ];

  const cards = [
    metricCard("Notes", summary.noteCount, "cyan"),
    metricCard("Commands", summary.commandCount, "green"),
    metricCard("Snapshots", summary.snapshotCount, "yellow"),
    metricCard("Failures", summary.failingCommandCount, "red"),
  ];

  const lines = [];
  lines.push("\x1b[?25l\x1b[2J\x1b[H");
  lines.push(...left);
  lines.push("");
  lines.push(cards.join("   "));
  lines.push("");
  if (flashMessage) {
    lines.push(`${ANSI.green}${flashMessage}${ANSI.reset}`);
    lines.push("");
  }
  lines.push(drawBox("Summary", wrapLines(session.summary || summarizeForDisplay(session), innerWidth), width));
  lines.push("");
  lines.push(drawBox("Recent Timeline", wrapLines(timelineLines.length > 0 ? timelineLines.join("\n") : "No events captured yet.", innerWidth), width));
  lines.push("");
  lines.push(`${ANSI.gray}Keys: q quit | r refresh | e export HTML${ANSI.reset}`);
  return lines.join("\n");
}

function metricCard(label, value, colorName) {
  const color = ANSI[colorName] || ANSI.cyan;
  return `${color}${ANSI.bold}${String(value).padStart(2, " ")}${ANSI.reset} ${ANSI.gray}${label}${ANSI.reset}`;
}

function drawBox(title, lines, width) {
  const innerWidth = width - 4;
  const label = `─ ${title} `;
  const top = `┌${label}${"─".repeat(Math.max(0, width - 2 - label.length))}┐`;
  const content = lines.map((line) => `│ ${padRight(line, innerWidth)} │`);
  const bottom = `└${"─".repeat(width - 2)}┘`;
  return [top, ...content, bottom].join("\n");
}

function summarizeForDisplay(session) {
  const findings = session.events.filter((event) => event.type === "note" && (event.kind === "finding" || event.kind === "decision"));
  if (findings.length === 0) {
    return "No executive summary yet. Add findings, decisions, or close the session with --summary.";
  }
  return findings.slice(-3).map((item) => `[${item.kind}] ${item.text}`).join(" | ");
}

function wrapLines(text, width) {
  const output = [];
  for (const block of String(text).split(/\r?\n/)) {
    const words = block.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      output.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > width && current) {
        output.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) {
      output.push(current);
    }
  }
  return output;
}

function padRight(value, width) {
  const plain = stripAnsi(value);
  const padding = Math.max(0, width - plain.length);
  return `${value}${" ".repeat(padding)}`;
}

function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-9;]*m/g, "");
}

function renderEventLine(event) {
  if (event.type === "note") {
    return `${event.at} | ${event.kind} | ${event.text}`;
  }
  if (event.type === "command") {
    const exitText = event.exitCode === null ? "exit ?" : `exit ${event.exitCode}`;
    const source = event.source === "history" ? "cmd/history" : "cmd";
    return `${event.at} | ${source} | ${event.command} | ${exitText}`;
  }
  if (event.type === "attachment") {
    return `${event.at} | attachment | ${event.storedPath}`;
  }
  if (event.type === "snapshot") {
    return `${event.at} | snapshot | ${event.snapshotKind} | ${event.storedPath}`;
  }
  if (event.type === "status") {
    return `${event.at} | status | ${event.state}`;
  }
  return `${event.at} | ${event.type}`;
}

function summarizeSession(session) {
  let noteCount = 0;
  let commandCount = 0;
  let attachmentCount = 0;
  let snapshotCount = 0;
  let decisionCount = 0;
  let failingCommandCount = 0;

  for (const event of session.events) {
    if (event.type === "note") {
      noteCount += 1;
      if (event.kind === "decision") {
        decisionCount += 1;
      }
    } else if (event.type === "command") {
      commandCount += 1;
      if (event.exitCode !== null && event.exitCode !== 0) {
        failingCommandCount += 1;
      }
    } else if (event.type === "attachment") {
      attachmentCount += 1;
    } else if (event.type === "snapshot") {
      snapshotCount += 1;
    }
  }

  return {
    noteCount,
    commandCount,
    attachmentCount,
    snapshotCount,
    decisionCount,
    failingCommandCount,
  };
}

function buildSessionModel(session) {
  const summary = summarizeSession(session);
  const byKind = {};
  for (const kind of NOTE_KINDS) {
    byKind[kind] = [];
  }

  const commands = [];
  const attachments = [];
  const snapshots = [];
  const timelineLines = [];

  for (const event of session.events) {
    timelineLines.push(renderEventLine(event));
    if (event.type === "note") {
      byKind[event.kind].push(event);
    } else if (event.type === "command") {
      commands.push(event);
    } else if (event.type === "attachment") {
      attachments.push(event);
    } else if (event.type === "snapshot") {
      snapshots.push(event);
    }
  }

  const evidenceLines = [];
  for (const item of attachments) {
    evidenceLines.push(`- attachment: ${item.storedPath}${item.note ? ` - ${item.note}` : ""}`);
  }
  for (const item of snapshots) {
    evidenceLines.push(`- snapshot: ${item.snapshotKind} -> ${item.storedPath}${item.note ? ` - ${item.note}` : ""}`);
  }
  if (evidenceLines.length === 0) {
    evidenceLines.push("- No evidence captured yet.");
  }

  const summaryFallback =
    byKind.decision.slice(-1)[0]?.text ||
    byKind.finding.slice(-1)[0]?.text ||
    byKind.hypothesis.slice(-1)[0]?.text ||
    "Session captured without final summary yet.";

  return {
    summary,
    byKind,
    commands,
    attachments,
    snapshots,
    timelineLines: timelineLines.map((line) => `- ${line}`),
    evidenceLines,
    summaryFallback,
  };
}

function renderExitText(commandEvent) {
  if (commandEvent.exitCode === null || commandEvent.exitCode === undefined) {
    return "";
  }
  return ` (exit ${commandEvent.exitCode})`;
}

function appendLines(lines, values) {
  for (const value of values) {
    lines.push(value);
  }
}

function createSession(repoRoot, args, flags) {
  const title = joinArgs(args) || (flags.title ? String(flags.title).trim() : "");
  if (!title) {
    fail("Usage: tracepad start \"session title\"");
  }

  const sessionId = createSessionId();
  const now = isoNow();
  const branch = detectGitBranch(repoRoot);
  const session = {
    id: sessionId,
    title,
    status: "active",
    createdAt: now,
    updatedAt: now,
    repoRoot,
    branch,
    startedBy: process.env.USERNAME || process.env.USER || "unknown",
    summary: "",
    events: [],
  };

  const initialContext = flags.context ? String(flags.context).trim() : "";
  if (initialContext) {
    session.events.push(
      createEvent("note", {
        text: initialContext,
        kind: "context",
      })
    );
  }

  return session;
}

function createEvent(type, data) {
  return {
    type,
    at: isoNow(),
    ...data,
  };
}

function resolveSession(repoRoot, args, flags, options) {
  const allowPositionalId = Boolean(options && options.allowPositionalId);
  const requestedId = flags.session ? String(flags.session) : allowPositionalId ? firstArg(args) : "";

  if (requestedId) {
    return readSession(repoRoot, requestedId);
  }

  const state = getState(repoRoot);
  if (!state.activeSessionId) {
    fail("No active session. Start one with: tracepad start \"title\"");
  }
  return readSession(repoRoot, state.activeSessionId);
}

function ensureStore(repoRoot) {
  fs.mkdirSync(storeDir(repoRoot), { recursive: true });
  fs.mkdirSync(sessionsDir(repoRoot), { recursive: true });
  fs.mkdirSync(artifactsDir(repoRoot), { recursive: true });
  fs.mkdirSync(exportsDir(repoRoot), { recursive: true });
  const statePath = path.join(storeDir(repoRoot), "state.json");
  if (!fs.existsSync(statePath)) {
    writeJson(statePath, { version: 1, activeSessionId: null });
  }
}

function getState(repoRoot) {
  ensureStore(repoRoot);
  return readJson(path.join(storeDir(repoRoot), "state.json"));
}

function writeState(repoRoot, state) {
  writeJson(path.join(storeDir(repoRoot), "state.json"), state);
}

function setActiveSessionId(repoRoot, sessionId) {
  const state = getState(repoRoot);
  state.activeSessionId = sessionId;
  writeState(repoRoot, state);
}

function readSession(repoRoot, sessionId) {
  const filePath = path.join(sessionsDir(repoRoot), `${sessionId}.json`);
  if (!fs.existsSync(filePath)) {
    fail(`Session not found: ${sessionId}`);
  }
  return readJson(filePath);
}

function writeSession(repoRoot, session) {
  writeJson(path.join(sessionsDir(repoRoot), `${session.id}.json`), session);
}

function listSessions(repoRoot) {
  ensureStore(repoRoot);
  const entries = fs.readdirSync(sessionsDir(repoRoot), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readJson(path.join(sessionsDir(repoRoot), entry.name)));
}

function touchSession(session) {
  session.updatedAt = isoNow();
}

function determineShellName(shellFlag) {
  const explicit = String(shellFlag || "").trim().toLowerCase();
  if (explicit) {
    return explicit;
  }

  if (process.platform === "win32") {
    return "powershell";
  }
  return process.env.SHELL && process.env.SHELL.includes("zsh") ? "zsh" : "bash";
}

function resolveHistoryFile(fileFlag, shell) {
  if (fileFlag) {
    return path.resolve(String(fileFlag));
  }

  const home = os.homedir();
  if (shell === "powershell") {
    const candidates = [
      path.join(home, "AppData", "Roaming", "Microsoft", "Windows", "PowerShell", "PSReadLine", "ConsoleHost_history.txt"),
      path.join(home, "AppData", "Roaming", "Microsoft", "PowerShell", "PSReadLine", "ConsoleHost_history.txt"),
      path.join(home, ".local", "share", "powershell", "PSReadLine", "ConsoleHost_history.txt"),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  }

  if (shell === "bash") {
    return path.join(home, ".bash_history");
  }

  if (shell === "zsh") {
    return path.join(home, ".zsh_history");
  }

  if (shell === "plain") {
    return null;
  }

  fail(`Unsupported shell history type: ${shell}`);
}

function readShellHistory(filePath, shell) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (shell === "zsh") {
    return lines.map((line) => {
      const separator = line.indexOf(";");
      return separator >= 0 ? line.slice(separator + 1).trim() : line;
    });
  }

  return lines;
}

function runGit(repoRoot, args) {
  try {
    const output = childProcess.execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { output };
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : error.message;
    return { error: stderr || error.message };
  }
}

function countChangedFiles(diffText) {
  const matches = diffText.match(/^diff --git /gm);
  return matches ? matches.length : 0;
}

function detectGitBranch(repoRoot) {
  const headPath = path.join(repoRoot, ".git", "HEAD");
  if (!fs.existsSync(headPath)) {
    return null;
  }

  try {
    const head = fs.readFileSync(headPath, "utf8").trim();
    if (head.startsWith("ref:")) {
      const ref = head.split("/").slice(2).join("/");
      return ref || null;
    }
    return head || null;
  } catch (error) {
    return null;
  }
}

function normalizeNoteKind(value) {
  const kind = String(value || "note").trim().toLowerCase();
  if (!NOTE_KINDS.has(kind)) {
    fail(`Invalid note kind: ${value}`);
  }
  return kind;
}

function normalizeTemplate(value) {
  const template = String(value || "handoff").trim().toLowerCase();
  if (!EXPORT_TEMPLATES.has(template)) {
    fail(`Invalid export template: ${value}`);
  }
  return template;
}

function normalizeFormat(value, outputPath) {
  if (value) {
    const format = String(value).trim().toLowerCase();
    if (!EXPORT_FORMATS.has(format)) {
      fail(`Invalid export format: ${value}`);
    }
    return format;
  }

  if (outputPath && String(outputPath).toLowerCase().endsWith(".html")) {
    return "html";
  }
  return "markdown";
}

function ask(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function storeDir(repoRoot) {
  return path.join(repoRoot, ".tracepad");
}

function sessionsDir(repoRoot) {
  return path.join(storeDir(repoRoot), "sessions");
}

function artifactsDir(repoRoot) {
  return path.join(storeDir(repoRoot), "artifacts");
}

function exportsDir(repoRoot) {
  return path.join(storeDir(repoRoot), "exports");
}

function createArtifactPath(repoRoot, sessionId, fileName) {
  const targetDir = path.join(artifactsDir(repoRoot), sessionId);
  fs.mkdirSync(targetDir, { recursive: true });
  return path.join(targetDir, `${Date.now()}-${sanitizeFileName(fileName)}`);
}

function storeArtifactText(repoRoot, sessionId, text, fileName) {
  const targetPath = createArtifactPath(repoRoot, sessionId, fileName);
  fs.writeFileSync(targetPath, text, "utf8");
  return path.relative(repoRoot, targetPath).replace(/\\/g, "/");
}

function defaultExportPath(repoRoot, sessionId, format) {
  return path.join(exportsDir(repoRoot), `${sessionId}.${format === "html" ? "html" : "md"}`);
}

function createSessionId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${suffix}`;
}

function sanitizeFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function joinArgs(args) {
  return args.join(" ").trim();
}

function firstArg(args) {
  return args.length > 0 ? String(args[0]) : "";
}

function isoNow() {
  return new Date().toISOString();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function renderHelp() {
  return `${TOOL_NAME} ${TOOL_VERSION}

Usage:
  tracepad <command> [arguments] [--repo <path>]

High-signal workflow:
  record "title"
      Start a session, capture git status, import recent shell history, and drop into capture mode.

Commands:
  init
      Create the local .tracepad store in the target repo.

  start "title" [--context "why this session exists"]
      Start a new debugging session and make it active.

  record "title" [--context "..."] [--history-limit 12] [--no-history] [--no-status-snapshot]
      One-command debugging flight recorder flow.

  use <session-id>
      Switch the active session.

  list
      List known sessions in the repo.

  status [session-id]
      Show a concise session summary. Uses the active session by default.

  tui [session-id]
      Open the visual terminal dashboard. Keys: q quit, r refresh, e export HTML.

  note "text" [--kind note|finding|hypothesis|decision|blocker|context]
      Append a structured note to the active session.

  cmd "command text" [--exit-code <n>] [--note "result summary"]
      Record a command you ran and optional outcome.

  history [--shell powershell|bash|zsh] [--file <history-path>] [--limit <n>]
      Import recent shell commands into the active session.

  diff [--staged] [--note "why this diff matters"]
      Capture the current git diff into the session artifacts.

  capture
      Start compact interactive capture mode for fast note entry.

  attach <file-path> [--note "why it matters"]
      Copy an artifact into .tracepad/artifacts and link it to the session.

  export [session-id] [--format markdown|html] [--template handoff|issue|pr|postmortem] [--output <file>]
      Export the session as a polished brief.

  close [summary text] [--summary "summary text"]
      Close the active session and optionally store a final summary.

Examples:
  tracepad record "Auth refresh bug" --context "User login fails after warm cache"
  tracepad note "Duplicate refresh under parallel requests" --kind hypothesis
  tracepad cmd "mvn test -Dtest=AuthFlowTest" --exit-code 1 --note "Still fails"
  tracepad diff --note "State before fix commit"
  tracepad tui
  tracepad export --format html --template postmortem --output incident.html
`;
}

main().catch((error) => {
  fail(error && error.message ? error.message : String(error));
});
