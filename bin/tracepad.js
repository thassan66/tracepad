#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const TOOL_NAME = "Tracepad";
const TOOL_VERSION = "0.5.1";
const NOTE_KINDS = new Set(["note", "finding", "hypothesis", "decision", "blocker", "context"]);
const EXPORT_TEMPLATES = new Set(["handoff", "issue", "pr", "postmortem", "slack"]);
const EXPORT_FORMATS = new Set(["markdown", "html", "json"]);
const REDACTION_MODES = new Set(["normal", "full"]);
const REPLAY_FORMATS = new Set(["shell", "markdown"]);
const EXPORT_REDACTION_MODE = Symbol("tracepadExportRedactionMode");
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

async function main() {
  const parsed = parseArgv(process.argv.slice(2));
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
      handleInit(repoRoot, flags);
      return;
    case "alias":
      handleAlias(args, flags);
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
    case "parse":
      await handleParse(repoRoot, args, flags);
      return;
    case "replay":
      handleReplay(repoRoot, args, flags);
      return;
    case "import":
      await handlePluginImport(repoRoot, args, flags);
      return;
    case "view-browser":
      await handleViewBrowser(repoRoot, args, flags);
      return;
    case "branch-sync":
      handleBranchSync(repoRoot, flags);
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
    case "stop":
      handleStop(repoRoot, args, flags);
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

function handleInit(repoRoot, flags) {
  ensureStore(repoRoot);
  if (!flags["no-gitignore"]) {
    updateGitignore(repoRoot);
  }
  if (flags.hooks) {
    installHooks(repoRoot);
  }
  if (flags.shell || flags["install-shell"]) {
    installShellIntegration(flags.shell);
  }
  process.stdout.write(`${TOOL_NAME} store ready at ${storeDir(repoRoot)}\n`);
  if (flags.shell || flags["install-shell"]) {
    process.stdout.write("Passive terminal capture is installed. Open a new shell or reload your profile before starting a session.\n");
  }
}

function handleAlias(args, flags) {
  const subcommand = firstArg(args);
  if (subcommand !== "setup") {
    fail("Usage: tracepad alias setup [--shell bash|zsh|powershell] [--install]");
  }

  if (flags.install) {
    installShellIntegration(flags.shell);
    return;
  }

  process.stdout.write(`${renderShellIntegration(determineShellName(flags.shell))}\n`);
}

function installShellIntegration(shellFlag) {
  const shell = determineShellName(shellFlag);
  const snippet = renderShellIntegration(shell);
  const profilePath = resolveShellProfile(shell);
  if (!profilePath) {
    fail(`Cannot auto-install shell integration for ${shell}. Print the snippet and add it manually.`);
  }
  upsertProfileBlock(profilePath, snippet);
  process.stdout.write(`Installed Tracepad shell integration in ${profilePath}\n`);
}

function handleStart(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = createSession(repoRoot, args, flags);
  writeSession(repoRoot, session);
  setActiveSessionId(repoRoot, session.id);
  process.stdout.write(renderCliStart(session));
}

async function handleRecord(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = createSession(repoRoot, args, flags);
  writeSession(repoRoot, session);
  setActiveSessionId(repoRoot, session.id);

  const captured = [];

  if (!flags["no-status-snapshot"]) {
    const result = captureGitStatusSnapshot(repoRoot, session, "Session baseline");
    if (result.captured) {
      captured.push("git status");
    }
  }

  if (!flags["no-history"]) {
    const result = importHistoryIntoSession(repoRoot, session, {
      shell: flags.shell,
      file: flags.file,
      limit: flags["history-limit"] !== undefined ? Number(flags["history-limit"]) : 12,
      silent: true,
    });
    if (result.imported > 0) {
      captured.push(`${result.imported} history cmd(s)`);
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
    process.stdout.write(`${renderCliPanel("Tracepad Sessions", ["No sessions yet.", "Start one with: tracepad start \"Debug title\""])}\n`);
    return;
  }

  const lines = [];
  for (const session of sessions) {
    const summary = summarizeSession(session);
    const marker = session.id === activeId ? "*" : " ";
    lines.push(`${marker} ${session.id}  ${session.status}  ${formatDisplayTime(session.updatedAt)}`);
    lines.push(`  ${session.title}`);
    lines.push(`  ${summary.noteCount} notes | ${summary.commandCount} cmds | ${summary.snapshotCount + summary.attachmentCount} evidence | ${summary.failingCommandCount} failures`);
    lines.push("");
  }
  process.stdout.write(`${renderCliPanel(`${TOOL_NAME} Sessions`, lines)}\n`);
}

function handleStatus(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: true });
  process.stdout.write(renderCliStatus(session));
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

  let flashMessage = "";
  let selectedIndex = 0;
  let previewOffset = 0;

  const rerender = () => {
    const fresh = readSession(repoRoot, session.id);
    const visibleEvents = fresh.events.slice(-8);
    selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(visibleEvents.length - 1, 0)));
    const preview = buildTuiPreview(repoRoot, fresh, visibleEvents[selectedIndex], previewOffset);
    previewOffset = preview.offset;
    process.stdout.write(renderTuiScreen(fresh, flashMessage, { selectedIndex, preview }));
    flashMessage = "";
  };

  rerender();

  await new Promise((resolve) => {
    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdout.write("\x1b[0m\x1b[?25h");
    };

    const onKeypress = async (str, key) => {
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
        flashMessage = `Exported HTML to ${outputPath}`;
        rerender();
        return;
      }

      if (key.name === "d") {
        handleDiffSnapshot(repoRoot, { session: session.id, note: "Captured from TUI" });
        selectedIndex = Math.max(0, readSession(repoRoot, session.id).events.slice(-8).length - 1);
        previewOffset = 0;
        flashMessage = "Captured git diff snapshot";
        rerender();
        return;
      }

      if (key.name === "n") {
        const answer = await promptTuiTextInput(process.stdin, process.stdout, "note> ");
        if (answer.trim()) {
          handleNote(repoRoot, [answer.trim()], { session: session.id, kind: "note" });
          selectedIndex = Math.max(0, readSession(repoRoot, session.id).events.slice(-8).length - 1);
          previewOffset = 0;
          flashMessage = "Added note";
        }
        rerender();
        return;
      }

      if (key.name === "left" || str === "[") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        previewOffset = 0;
        rerender();
        return;
      }

      if (key.name === "right" || str === "]") {
        const fresh = readSession(repoRoot, session.id);
        const maxIndex = Math.max(0, fresh.events.slice(-8).length - 1);
        selectedIndex = Math.min(maxIndex, selectedIndex + 1);
        previewOffset = 0;
        rerender();
        return;
      }

      if (key.name === "down" || key.name === "j") {
        previewOffset += 1;
        rerender();
        return;
      }

      if (key.name === "up" || key.name === "k") {
        previewOffset = Math.max(0, previewOffset - 1);
        rerender();
        return;
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}

function handleNote(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: false });
  const text = redactText(joinArgs(args));
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
  const commandText = redactText(joinArgs(args));
  if (!commandText) {
    fail("Usage: tracepad cmd \"mvn test -Dtest=FooTest\" [--exit-code 1] [--note \"what happened\"]");
  }

  const exitCode = flags["exit-code"] !== undefined ? Number(flags["exit-code"]) : null;
  const note = flags.note ? redactText(String(flags.note).trim()) : "";
  const source = flags.source ? redactText(String(flags.source).trim()) : "manual";
  session.events.push(
    createEvent("command", {
      command: commandText,
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      note,
      source: source || "manual",
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
        command: redactText(command),
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

async function handleParse(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: false });
  const sourceArg = firstArg(args);
  if (!sourceArg) {
    fail("Usage: tracepad parse <log-file> [--context-lines 2] [--note \"why this matters\"]");
  }

  const sourcePath = path.isAbsolute(sourceArg) ? sourceArg : path.resolve(repoRoot, sourceArg);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    fail(`Parse target not found or not a file: ${sourcePath}`);
  }

  const contextLines = flags["context-lines"] !== undefined ? Number(flags["context-lines"]) : 2;
  if (!Number.isFinite(contextLines) || contextLines < 0) {
    fail("Invalid --context-lines value");
  }

  const maxMatches = flags["max-matches"] !== undefined ? Number(flags["max-matches"]) : 200;
  if (!Number.isFinite(maxMatches) || maxMatches <= 0) {
    fail("Invalid --max-matches value");
  }

  const result = await extractHighSignalLogSnippetFromFile(sourcePath, contextLines, maxMatches);
  if (!result.snippet.trim()) {
    process.stdout.write("No high-signal error lines found in the target file.\n");
    return;
  }

  const storedPath = storeArtifactText(repoRoot, session.id, redactText(result.snippet), `${path.basename(sourcePath)}.snippet.txt`);
  session.events.push(
    createEvent("snapshot", {
      snapshotKind: "parsed-log",
      storedPath,
      changedFiles: result.matchCount,
      note: redactText(flags.note ? String(flags.note).trim() : `Extracted ${result.matchCount} high-signal log match(es)`),
    })
  );
  touchSession(session);
  writeSession(repoRoot, session);
  process.stdout.write(`Parsed ${sourcePath} into ${storedPath}\n`);
}

function handleReplay(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: true });
  const format = normalizeReplayFormat(flags.format || (flags.markdown ? "markdown" : "shell"));
  const output = renderReplay(session, format);
  const outputPath = flags.output ? path.resolve(String(flags.output)) : null;

  if (!outputPath) {
    process.stdout.write(`${output}\n`);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${output}\n`, "utf8");
  process.stdout.write(`Replayed session ${session.id} to ${outputPath}\n`);
}

async function handlePluginImport(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const importerName = firstArg(args);
  if (!importerName) {
    fail("Usage: tracepad import <importer-name> [--file <path>] [--note \"why it matters\"]");
  }

  const session = resolveSession(repoRoot, [], flags, { allowPositionalId: false });
  const plugin = loadPlugin(repoRoot, "importers", importerName);
  if (!plugin || typeof plugin.importSessionData !== "function") {
    fail(`Importer ${importerName} must export importSessionData(context).`);
  }

  const result = await plugin.importSessionData({
    repoRoot,
    session,
    args: args.slice(1),
    flags,
    helpers: createPluginHelpers(repoRoot, session),
  }) || {};

  const events = Array.isArray(result.events) ? result.events : [];
  for (const event of events) {
    session.events.push({ at: isoNow(), ...event });
  }

  if (events.length > 0) {
    touchSession(session);
    writeSession(repoRoot, session);
  }

  process.stdout.write(`Importer ${importerName} added ${events.length} event(s) to ${session.id}\n`);
}

async function handleViewBrowser(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const sourceArg = firstArg(args) || flags.file;
  if (!sourceArg) {
    fail("Usage: tracepad view-browser <browser-capture.json> [--output <file>] [--redaction normal|full] [--no-open]");
  }

  const sourcePath = path.isAbsolute(sourceArg) ? sourceArg : path.resolve(repoRoot, sourceArg);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    fail(`Browser capture file not found: ${sourcePath}`);
  }

  const title = flags.title ? String(flags.title).trim() : `Browser capture preview: ${path.basename(sourcePath)}`;
  const session = createSession(repoRoot, [title], {
    context: flags.context || `Preview generated from ${path.basename(sourcePath)}`,
  });
  const plugin = loadPlugin(repoRoot, "importers", "browser-capture");
  if (!plugin || typeof plugin.importSessionData !== "function") {
    fail("browser-capture importer must export importSessionData(context).");
  }

  const result = await plugin.importSessionData({
    repoRoot,
    session,
    args: [],
    flags: {
      ...flags,
      file: sourcePath,
      note: flags.note || `Previewed ${path.basename(sourcePath)}`,
    },
    helpers: createPluginHelpers(repoRoot, session),
  }) || {};

  const events = Array.isArray(result.events) ? result.events : [];
  for (const event of events) {
    session.events.push({ at: isoNow(), ...event });
  }
  session.status = "closed";
  session.events.push(
    createEvent("status", {
      state: "closed",
      note: "Browser capture preview generated",
    })
  );
  touchSession(session);
  writeSession(repoRoot, session);

  const template = normalizeTemplate(flags.template || "postmortem");
  const redaction = normalizeRedactionMode(flags.redaction || (flags["full-redaction"] ? "full" : "normal"));
  const outputPath = flags.output ? path.resolve(String(flags.output)) : defaultExportPath(repoRoot, session.id, "html");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${renderExport(session, { format: "html", template, redaction })}\n`, "utf8");

  const lines = [
    `Browser capture preview imported ${events.length} event(s).`,
    `Session: ${session.id}`,
    `Redaction: ${redaction}`,
    `Visual report: ${outputPath}`,
    "",
    "Next:",
    "  open the visual report path above",
    `  tracepad status ${session.id}`,
  ];
  if (!flags["no-open"]) {
    const opened = openFile(outputPath);
    lines.push(opened ? "Opened visual report." : "Could not auto-open the report. Open the path above manually.");
  }
  process.stdout.write(`${renderCliPanel("Browser Capture Preview", lines)}\n`);
}

function handleBranchSync(repoRoot, flags) {
  ensureStore(repoRoot);
  const branch = detectGitBranch(repoRoot);
  if (!branch) {
    process.stdout.write("No git branch detected for branch sync.\n");
    return;
  }

  const matched = findBranchSession(repoRoot, branch);
  if (matched) {
    setActiveSessionId(repoRoot, matched.id);
    process.stdout.write(`Active session set to ${matched.id} for branch ${branch}\n`);
    return;
  }

  if (!flags["create-if-missing"]) {
    process.stdout.write(`No existing session found for branch ${branch}\n`);
    return;
  }

  const session = createSession(repoRoot, [`Branch ${branch}`], { context: `Auto-created for branch ${branch}` });
  writeSession(repoRoot, session);
  setActiveSessionId(repoRoot, session.id);
  process.stdout.write(`Created session ${session.id} for branch ${branch}\n`);
}

function handleDiffSnapshot(repoRoot, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, [], flags, { allowPositionalId: false });
  const staged = Boolean(flags.staged);
  const commitRef = flags.commit ? String(flags.commit).trim() : "";
  const git = commitRef
    ? runGit(repoRoot, ["show", "--no-color", commitRef])
    : runGit(repoRoot, staged ? ["diff", "--staged", "--no-color"] : ["diff", "--no-color"]);

  if (git.error) {
    fail(`Could not capture git diff: ${git.error}`);
  }

  const diffText = git.output;
  if (!diffText.trim()) {
    process.stdout.write("No git diff output to capture.\n");
    return;
  }

  const fileName = commitRef ? `commit-${sanitizeFileName(commitRef)}.patch` : `${staged ? "staged" : "working-tree"}-diff.patch`;
  const storedPath = storeArtifactText(repoRoot, session.id, diffText, fileName);
  session.events.push(
    createEvent("snapshot", {
      snapshotKind: commitRef ? "git-show" : staged ? "git-diff-staged" : "git-diff",
      storedPath,
      changedFiles: countChangedFiles(diffText),
      note: redactText(flags.note ? String(flags.note).trim() : ""),
    })
  );
  touchSession(session);
  writeSession(repoRoot, session);
  process.stdout.write(`Captured git diff snapshot to ${storedPath}\n`);
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

  const storedPath = storeArtifactText(repoRoot, session.id, `${output}\n`, "git-status.txt");
  const changedFiles = output
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("##"))
    .length;

  session.events.push(
    createEvent("snapshot", {
      snapshotKind: "git-status",
      storedPath,
      changedFiles,
      note: note || "",
    })
  );
  touchSession(session);
  return { captured: true, path: storedPath };
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
  const note = flags.note ? redactText(String(flags.note).trim()) : "";

  if (flags.clip) {
    const clipText = getClipboardText();
    if (!clipText.trim()) {
      fail("Clipboard is empty or unavailable.");
    }

    const storedPath = storeArtifactText(repoRoot, session.id, redactText(clipText), "clipboard.txt");
    session.events.push(
      createEvent("attachment", {
        originalPath: "clipboard",
        storedPath,
        note: note || "Captured from clipboard",
      })
    );
    touchSession(session);
    writeSession(repoRoot, session);
    process.stdout.write(`Attached clipboard contents to ${session.id}\n`);
    return;
  }

  const sourceArg = firstArg(args);
  if (!sourceArg) {
    fail("Usage: tracepad attach <path-to-file> [--note \"why it matters\"] [--clip]");
  }

  const sourcePath = path.isAbsolute(sourceArg) ? sourceArg : path.resolve(repoRoot, sourceArg);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    fail(`Attachment not found or not a file: ${sourcePath}`);
  }

  const targetPath = createArtifactPath(repoRoot, session.id, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, targetPath);
  const storedPath = path.relative(repoRoot, targetPath).replace(/\\/g, "/");
  session.events.push(
    createEvent("attachment", {
      originalPath: sourcePath,
      storedPath,
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
  const summary = redactText(flags.summary ? String(flags.summary).trim() : joinArgs(args));

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

function handleStop(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: false });
  const summary = redactText(flags.summary ? String(flags.summary).trim() : joinArgs(args));

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

  const format = normalizeFormat(flags.format || "html", flags.output);
  const template = normalizeTemplate(flags.template || "handoff");
  const redaction = normalizeRedactionMode(flags.redaction || (flags["full-redaction"] ? "full" : "normal"));
  const outputPath = flags.output ? path.resolve(String(flags.output)) : defaultExportPath(repoRoot, session.id, format);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${renderExport(session, { format, template, redaction })}\n`, "utf8");

  process.stdout.write(renderCliStop(session, outputPath, redaction));
}

function handleExport(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: true });
  const template = normalizeTemplate(flags.template);
  const format = normalizeFormat(flags.format, flags.output);
  const redaction = normalizeRedactionMode(flags.redaction || (flags["full-redaction"] ? "full" : "normal"));
  const exportSession = prepareSessionForExport(session, redaction);
  const exporter = flags.exporter || (template === "slack" ? "slack" : "");
  const output = exporter
    ? renderPluginExport(repoRoot, exportSession, { exporter: String(exporter), format, template, flags })
    : renderExport(exportSession, { format, template, redaction });
  const outputPath = flags.output ? path.resolve(String(flags.output)) : null;

  if (!outputPath) {
    process.stdout.write(`${output}\n`);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${output}\n`, "utf8");
  process.stdout.write(`Exported session ${session.id} to ${outputPath} (redaction: ${redaction})\n`);
}

function renderExport(session, options) {
  const template = normalizeTemplate(options.template);
  const format = normalizeFormat(options.format);
  const redaction = normalizeRedactionMode(options.redaction || getExportRedactionMode(session));
  const exportSession = getExportRedactionMode(session) === redaction ? session : prepareSessionForExport(session, redaction);

  if (format === "json") {
    return `${JSON.stringify(exportSession, null, 2)}\n`;
  }

  if (format === "html") {
    return renderHtmlTemplate(exportSession, template);
  }

  return renderMarkdownTemplate(exportSession, template);
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
    renderHtmlReviewWorkbench(session, model),
    renderHtmlExecutivePanel(session, model),
    renderHtmlInsightPanel(model),
    renderHtmlBrowserBoard(model),
    renderHtmlEvidenceGrid(session, model),
    renderHtmlSection("Findings", model.byKind.finding.map((item) => renderHtmlNoteItem(item)), "No findings captured yet."),
    renderHtmlSection("Hypotheses", model.byKind.hypothesis.map((item) => renderHtmlNoteItem(item)), "No hypotheses captured yet."),
    renderHtmlSection(
      "Commands",
      model.commands.map((item) => renderHtmlCommandItem(item)),
      "No commands captured yet."
    ),
    renderHtmlDiffSnapshots(session, model),
    renderHtmlTimelineCards(session),
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(session.title)} - ${TOOL_NAME}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --surface: #ffffff;
      --surface-strong: #111827;
      --panel: #ffffff;
      --line: #d8dde5;
      --line-strong: #b9c1cc;
      --text: #17202a;
      --muted: #687385;
      --blue: #246bfe;
      --green: #16835f;
      --yellow: #a96800;
      --rose: #bd2f4b;
      --ink: #111827;
      --red-bg: #fff0f2;
      --green-bg: #ecf8f3;
      --blue-bg: #edf4ff;
      --yellow-bg: #fff7e6;
      --shadow: 0 18px 42px rgba(17, 24, 39, 0.10);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, Segoe UI, Arial, sans-serif;
      background: linear-gradient(180deg, #f8fafc 0%, var(--bg) 320px);
      color: var(--text);
      line-height: 1.5;
    }
    [hidden] { display: none !important; }
    .shell {
      width: min(1180px, calc(100vw - 28px));
      margin: 0 auto;
      padding: 18px 0 44px;
    }
    .hero, .section, .metric, .evidence-card, .timeline-card, .browser-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04);
    }
    .topbar {
      align-items: center;
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      gap: 12px;
    }
    .brand {
      color: var(--ink);
      font-weight: 800;
      letter-spacing: 0;
    }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .quick-nav {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .quick-nav a {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      font-size: 0.86rem;
      padding: 6px 10px;
      text-decoration: none;
    }
    .quick-nav a:hover { border-color: var(--blue); color: var(--blue); }
    button, .link-button {
      appearance: none;
      background: var(--surface);
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      font: inherit;
      font-size: 0.9rem;
      padding: 8px 10px;
      text-decoration: none;
    }
    button:hover, .link-button:hover { border-color: var(--blue); color: var(--blue); }
    button.active {
      background: var(--ink);
      border-color: var(--ink);
      color: #fff;
    }
    .hero {
      background: var(--surface-strong);
      border-color: #0f172a;
      color: #fff;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 20px;
      margin-bottom: 14px;
      padding: 24px;
      box-shadow: var(--shadow);
    }
    .hero h1 { margin: 0 0 10px; font-size: clamp(1.45rem, 2.4vw, 2.35rem); line-height: 1.08; }
    .eyebrow { margin: 0 0 10px; color: #93c5fd; text-transform: uppercase; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.08em; }
    .summary-text { color: #d6dde8; max-width: 72ch; margin: 0; }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    .pill {
      align-items: center;
      background: rgba(255,255,255,0.09);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 999px;
      color: #e6edf7;
      display: inline-flex;
      font-size: 0.82rem;
      gap: 6px;
      padding: 5px 9px;
      white-space: nowrap;
    }
    .hero-status {
      align-self: start;
      background: #fff;
      border-radius: 8px;
      color: var(--ink);
      min-width: 180px;
      padding: 14px;
    }
    .hero-status strong { display: block; font-size: 1.6rem; line-height: 1; }
    .hero-status span { color: var(--muted); font-size: 0.82rem; }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 10px; margin-bottom: 14px; }
    .metric { min-height: 92px; padding: 14px; position: relative; }
    .metric strong { display: block; font-size: 1.65rem; line-height: 1.1; }
    .metric span { color: var(--muted); font-size: 0.82rem; }
    .metric small { color: var(--muted); display: block; margin-top: 7px; }
    .metric::before {
      background: var(--blue);
      border-radius: 999px;
      content: "";
      height: 4px;
      left: 14px;
      position: absolute;
      right: 14px;
      top: 0;
    }
    .metric.findings::before { background: var(--rose); }
    .metric.commands::before { background: var(--blue); }
    .metric.evidence::before { background: var(--green); }
    .metric.failures::before { background: var(--yellow); }
    .section { padding: 18px; margin-bottom: 14px; }
    .section-header {
      align-items: center;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .section h2 { margin: 0; font-size: 1rem; letter-spacing: 0; }
    .section-subtitle { color: var(--muted); font-size: 0.88rem; margin: 3px 0 0; }
    .grid-2 { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 14px; }
    .workbench-grid { display: grid; grid-template-columns: 0.75fr 1.25fr 1fr; gap: 12px; }
    .browser-grid, .evidence-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
    .insight-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
    .browser-card, .evidence-card { padding: 14px; box-shadow: none; }
    .insight-card {
      background: #fbfdff;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .browser-card strong, .evidence-card strong, .insight-card strong { display: block; margin-bottom: 6px; }
    .browser-card p, .evidence-card p, .insight-card p { color: var(--muted); margin: 0; overflow-wrap: anywhere; }
    .insight-card ul { padding-left: 18px; }
    .score-card {
      background: #111827;
      border-radius: 8px;
      color: #fff;
      padding: 16px;
    }
    .score-card strong {
      display: block;
      font-size: 2.8rem;
      line-height: 1;
      margin-bottom: 8px;
    }
    .score-card span { color: #bfdbfe; display: block; font-weight: 800; margin-bottom: 8px; }
    .score-card p { color: #d6dde8; margin: 0; }
    .review-card {
      background: #fbfdff;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .review-card h3 {
      font-size: 0.95rem;
      margin: 0 0 8px;
    }
    .review-list {
      list-style: none;
      padding: 0;
    }
    .review-list li {
      align-items: flex-start;
      display: grid;
      gap: 8px;
      grid-template-columns: 18px minmax(0, 1fr);
      margin-top: 8px;
    }
    .check-dot {
      border-radius: 999px;
      display: inline-block;
      height: 10px;
      margin-top: 6px;
      width: 10px;
    }
    .check-dot.pass { background: var(--green); }
    .check-dot.warn { background: var(--yellow); }
    .check-dot.fail { background: var(--rose); }
    .ai-prompt {
      background: #0f172a;
      border: 1px solid #1f2937;
      border-radius: 8px;
      color: #e5edf7;
      font-family: Consolas, Menlo, monospace;
      font-size: 0.82rem;
      line-height: 1.45;
      margin: 10px 0 0;
      max-height: 260px;
      overflow: auto;
      padding: 12px;
      white-space: pre-wrap;
    }
    .empty-state {
      background: #f8fafc;
      border: 1px dashed var(--line-strong);
      border-radius: 8px;
      color: var(--muted);
      padding: 16px;
    }
    ul { margin: 0; padding-left: 20px; }
    li + li { margin-top: 8px; }
    .note-list { list-style: none; padding-left: 0; }
    .note-list li {
      border-left: 3px solid var(--blue);
      padding: 8px 0 8px 10px;
    }
    .note-list li.finding { border-color: var(--rose); }
    .note-list li.hypothesis { border-color: var(--yellow); }
    .note-list li.decision { border-color: var(--green); }
    .note-meta { color: var(--muted); display: block; font-size: 0.78rem; margin-bottom: 2px; }
    code {
      background: #f1f5f9;
      border: 1px solid #dbe3ee;
      border-radius: 6px;
      padding: 2px 6px;
      font-family: Consolas, Menlo, monospace;
      font-size: 0.92em;
    }
    .muted { color: var(--muted); }
    .timeline-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .timeline-toolbar {
      align-items: center;
      display: flex;
      gap: 10px;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .timeline-search {
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      color: var(--text);
      font: inherit;
      min-width: min(320px, 100%);
      padding: 8px 10px;
    }
    .timeline-list {
      display: grid;
      gap: 10px;
    }
    .timeline-card {
      box-shadow: none;
      display: grid;
      grid-template-columns: 118px minmax(0, 1fr);
      overflow: hidden;
    }
    .timeline-card .time {
      background: #f8fafc;
      border-right: 1px solid var(--line);
      color: var(--muted);
      font-family: Consolas, Menlo, monospace;
      font-size: 0.78rem;
      padding: 12px;
    }
    .timeline-card .content { padding: 12px; }
    .event-title { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
    .badge {
      border-radius: 999px;
      display: inline-flex;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.03em;
      padding: 3px 8px;
      text-transform: uppercase;
    }
    .badge.finding, .badge.blocker, .badge.failed { background: var(--red-bg); color: var(--rose); }
    .badge.context, .badge.snapshot, .badge.attachment { background: var(--blue-bg); color: var(--blue); }
    .badge.decision, .badge.pass { background: var(--green-bg); color: var(--green); }
    .badge.hypothesis, .badge.command { background: var(--yellow-bg); color: var(--yellow); }
    .event-text { margin: 0; overflow-wrap: anywhere; }
    .artifact-image {
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 6px;
      display: block;
      margin-top: 10px;
      max-height: 260px;
      max-width: 100%;
      object-fit: contain;
    }
    .image-preview-button {
      background: transparent;
      border: 0;
      cursor: zoom-in;
      display: block;
      margin: 0;
      padding: 0;
      text-align: left;
      width: 100%;
    }
    .image-preview-button:hover .artifact-image { border-color: var(--blue); }
    .image-viewer {
      align-items: center;
      background: rgba(17, 24, 39, 0.84);
      inset: 0;
      justify-content: center;
      padding: 18px;
      position: fixed;
      z-index: 50;
    }
    .image-viewer:not([hidden]) { display: flex; }
    .image-viewer-panel {
      background: #ffffff;
      border-radius: 8px;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      max-height: calc(100vh - 36px);
      max-width: calc(100vw - 36px);
      overflow: hidden;
      width: min(1100px, calc(100vw - 36px));
    }
    .image-viewer-toolbar {
      align-items: center;
      border-bottom: 1px solid var(--line);
      display: flex;
      gap: 8px;
      justify-content: space-between;
      padding: 10px;
    }
    .image-viewer-toolbar strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .image-viewer-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .image-viewer-stage {
      background: #0f172a;
      overflow: auto;
      padding: 16px;
      text-align: center;
    }
    .image-viewer-stage img {
      max-width: none;
      transform-origin: top center;
      vertical-align: top;
    }
    details.diff-file {
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      margin-top: 12px;
      background: #fbfdff;
    }
    details.diff-file summary {
      cursor: pointer;
      padding: 10px 12px;
      color: var(--text);
      background: #f8fafc;
    }
    .diff-view {
      margin: 0;
      overflow-x: auto;
      font-family: Consolas, Menlo, monospace;
      font-size: 0.86rem;
      line-height: 1.45;
    }
    .diff-line {
      display: grid;
      grid-template-columns: 64px minmax(0, 1fr);
      min-width: 720px;
      border-top: 1px solid #edf1f6;
    }
    .diff-line .ln {
      color: var(--muted);
      padding: 2px 10px;
      text-align: right;
      user-select: none;
      background: #f8fafc;
    }
    .diff-line .code {
      white-space: pre;
      padding: 2px 10px;
    }
    .diff-add { background: var(--green-bg); }
    .diff-del { background: var(--red-bg); }
    .diff-hunk { background: var(--blue-bg); color: var(--blue); }
    .diff-meta { color: var(--muted); }
    @media print {
      .topbar, .quick-nav, .timeline-controls, .timeline-toolbar button, .timeline-search { display: none; }
      body { background: #fff; }
      .hero, .section, .metric, .timeline-card, .browser-card, .evidence-card { box-shadow: none; }
    }
    @media (max-width: 760px) {
      .hero, .grid-2, .workbench-grid { grid-template-columns: 1fr; }
      .metrics, .browser-grid, .evidence-grid, .insight-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .hero h1 { font-size: 1.55rem; }
      .timeline-card { grid-template-columns: 1fr; }
      .timeline-card .time { border-right: 0; border-bottom: 1px solid var(--line); }
      .timeline-toolbar { align-items: stretch; flex-direction: column; }
    }
    @media (max-width: 520px) {
      .metrics, .browser-grid, .evidence-grid, .insight-grid { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <div class="topbar">
      <div class="brand">Tracepad Report</div>
      <div class="actions">
        <button type="button" onclick="window.print()">Print</button>
        <button type="button" onclick="copyLocation()">Copy link</button>
      </div>
    </div>
    <nav class="quick-nav" aria-label="Report sections">
      <a href="#review">Review</a>
      <a href="#insights">Insights</a>
      <a href="#browser">Browser</a>
      <a href="#evidence">Evidence</a>
      <a href="#timeline">Timeline</a>
    </nav>
    ${body}
  </main>
  <div id="imageViewer" class="image-viewer" hidden>
    <div class="image-viewer-panel" role="dialog" aria-modal="true" aria-label="Screenshot preview">
      <div class="image-viewer-toolbar">
        <strong id="imageViewerTitle">Screenshot</strong>
        <div class="image-viewer-actions">
          <button type="button" onclick="zoomImage(-0.25)">Zoom out</button>
          <button type="button" onclick="zoomImage(0.25)">Zoom in</button>
          <button type="button" onclick="resetImageZoom()">Reset</button>
          <button type="button" onclick="closeImagePreview()">Close</button>
        </div>
      </div>
      <div class="image-viewer-stage">
        <img id="imageViewerImage" alt="" />
      </div>
    </div>
  </div>
  <script>
    var imageZoom = 1;
    var activeTimelineKind = "all";
    function filterTimeline(kind) {
      activeTimelineKind = kind || "all";
      document.querySelectorAll("[data-filter]").forEach((button) => {
        button.classList.toggle("active", button.dataset.filter === activeTimelineKind);
      });
      applyTimelineFilters();
    }
    function applyTimelineFilters() {
      var search = (document.getElementById("timelineSearch") || { value: "" }).value.toLowerCase().trim();
      document.querySelectorAll("[data-event-kind]").forEach((card) => {
        const kinds = (card.dataset.eventKinds || card.dataset.eventKind || "").split(" ");
        var matchesKind = activeTimelineKind === "all" || kinds.includes(activeTimelineKind);
        var matchesSearch = !search || (card.dataset.search || card.textContent || "").toLowerCase().includes(search);
        card.hidden = !matchesKind || !matchesSearch;
      });
    }
    function copyTextById(id) {
      var element = document.getElementById(id);
      if (element && navigator.clipboard) {
        navigator.clipboard.writeText(element.textContent || "");
      }
    }
    function copyLocation() {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href);
      }
    }
    function openImagePreview(src, alt) {
      var viewer = document.getElementById("imageViewer");
      var image = document.getElementById("imageViewerImage");
      var title = document.getElementById("imageViewerTitle");
      imageZoom = 1;
      image.src = src;
      image.alt = alt || "Screenshot";
      image.style.transform = "scale(1)";
      title.textContent = alt || "Screenshot";
      viewer.hidden = false;
    }
    function closeImagePreview() {
      var viewer = document.getElementById("imageViewer");
      var image = document.getElementById("imageViewerImage");
      viewer.hidden = true;
      image.removeAttribute("src");
    }
    function zoomImage(delta) {
      var image = document.getElementById("imageViewerImage");
      imageZoom = Math.max(0.25, Math.min(4, imageZoom + delta));
      image.style.transform = "scale(" + imageZoom + ")";
    }
    function resetImageZoom() {
      imageZoom = 1;
      document.getElementById("imageViewerImage").style.transform = "scale(1)";
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeImagePreview();
      }
    });
  </script>
</body>
</html>`;
}

function renderHtmlHero(session, label) {
  const redaction = getExportRedactionMode(session);
  return `<section class="hero">
    <div>
      <p class="eyebrow">${escapeHtml(label)}</p>
      <h1>${escapeHtml(session.title)}</h1>
      <p class="summary-text">${escapeHtml(session.summary || summarizeForDisplay(session))}</p>
      <div class="meta">
        <span class="pill">Session ${escapeHtml(session.id)}</span>
        <span class="pill">Branch ${escapeHtml(session.branch || "unknown")}</span>
        <span class="pill">Redaction ${escapeHtml(redaction)}</span>
        <span class="pill">Updated ${escapeHtml(formatDisplayTime(session.updatedAt))}</span>
      </div>
    </div>
    <div class="hero-status">
      <strong>${escapeHtml(session.status)}</strong>
      <span>Report status</span>
    </div>
  </section>`;
}

function renderHtmlMetrics(model) {
  const metrics = [
    { value: model.byKind.finding.length, label: "Findings", className: "findings", hint: "Signals that need attention" },
    { value: model.summary.commandCount, label: "Commands", className: "commands", hint: "Terminal activity captured" },
    { value: model.summary.snapshotCount + model.summary.attachmentCount, label: "Evidence", className: "evidence", hint: "Snapshots and attachments" },
    { value: model.summary.failingCommandCount, label: "Failed Commands", className: "failures", hint: "Non-zero exits" },
    { value: model.byKind.context.length, label: "Context Notes", className: "context", hint: "Browser tabs and background" },
  ];
  return `<section class="metrics">
    ${metrics.map((item) => `<article class="metric ${escapeHtml(item.className)}"><strong>${escapeHtml(String(item.value))}</strong><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.hint)}</small></article>`).join("")}
  </section>`;
}

function renderHtmlReviewWorkbench(session, model) {
  const review = buildReviewModel(session, model);
  const checklist = review.checklist.map((item) => `<li>
    <span class="check-dot ${escapeHtml(item.state)}"></span>
    <span><strong>${escapeHtml(item.label)}</strong><br><span class="muted">${escapeHtml(item.detail)}</span></span>
  </li>`).join("");
  const evidence = review.topEvidence.length > 0
    ? review.topEvidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : `<li><span class="muted">No priority evidence yet. Add findings, failed commands, browser captures, or snapshots.</span></li>`;

  return `<section class="section" id="review">
    <div class="section-header">
      <div>
        <h2>Review Workbench</h2>
        <p class="section-subtitle">A handoff-ready view of signal strength, missing context, priority evidence, and AI-ready summary text.</p>
      </div>
    </div>
    <div class="workbench-grid">
      <article class="score-card">
        <strong>${escapeHtml(String(review.score))}</strong>
        <span>${escapeHtml(review.scoreLabel)}</span>
        <p>${escapeHtml(review.scoreDetail)}</p>
      </article>
      <article class="review-card">
        <h3>Review Checklist</h3>
        <ul class="review-list">${checklist}</ul>
      </article>
      <article class="review-card">
        <h3>Priority Evidence</h3>
        <ul>${evidence}</ul>
      </article>
    </div>
    <div class="review-card" style="margin-top: 12px;">
      <div class="section-header" style="margin-bottom: 0;">
        <div>
          <h3>AI Handoff Prompt</h3>
          <p class="section-subtitle">Copy into any AI tool when you want a root-cause summary, comparison, hypotheses, and next checks. Tracepad does not send it anywhere.</p>
        </div>
        <button type="button" onclick="copyTextById('aiPrompt')">Copy prompt</button>
      </div>
      <pre class="ai-prompt" id="aiPrompt">${escapeHtml(review.aiPrompt)}</pre>
    </div>
  </section>`;
}

function buildReviewModel(session, model) {
  const browserSignals = collectBrowserSignals(model);
  const failedCommands = model.commands.filter((item) => item.exitCode !== null && item.exitCode !== undefined && item.exitCode !== 0);
  const evidenceCount = model.snapshots.length + model.attachments.length;
  const hasSummary = Boolean(String(session.summary || "").trim());
  const hasFinding = model.byKind.finding.length + model.byKind.blocker.length > 0;
  const hasHypothesis = model.byKind.hypothesis.length > 0;
  const hasDecision = model.byKind.decision.length > 0;
  const hasEvidence = evidenceCount > 0;
  const hasBrowser = browserSignals.length > 0 || model.snapshots.some((item) => item.snapshotKind === "browser-capture-summary");
  const score = Math.min(100,
    (hasSummary ? 18 : 0) +
    (hasFinding ? 22 : 0) +
    (hasHypothesis ? 14 : 0) +
    (hasDecision ? 14 : 0) +
    (hasEvidence ? 18 : 0) +
    (hasBrowser ? 14 : 0)
  );
  const scoreLabel = score >= 80 ? "Handoff ready" : score >= 55 ? "Useful, needs tightening" : "Capture more signal";
  const scoreDetail = score >= 80
    ? "This session has enough context for a reviewer to understand the investigation."
    : score >= 55
      ? "The report is useful, but a clearer summary, decision, or evidence snapshot would reduce back-and-forth."
      : "Add findings, hypotheses, evidence, and a final summary before sharing.";

  const checklist = [
    {
      label: "Final summary",
      state: hasSummary ? "pass" : "warn",
      detail: hasSummary ? "A closing summary is present." : "Run `tracepad stop \"summary\"` or export after adding a summary.",
    },
    {
      label: "Confirmed findings",
      state: hasFinding ? "pass" : "fail",
      detail: hasFinding ? `${model.byKind.finding.length + model.byKind.blocker.length} high-signal finding(s) captured.` : "Add at least one finding or blocker.",
    },
    {
      label: "Working hypothesis",
      state: hasHypothesis ? "pass" : "warn",
      detail: hasHypothesis ? `${model.byKind.hypothesis.length} hypothesis note(s) captured.` : "Add a hypothesis so reviewers know what you believe is happening.",
    },
    {
      label: "Evidence attached",
      state: hasEvidence ? "pass" : "warn",
      detail: hasEvidence ? `${evidenceCount} snapshot/attachment artifact(s) captured.` : "Attach logs, screenshots, HAR imports, or git diff snapshots.",
    },
    {
      label: "Share safety",
      state: getExportRedactionMode(session) === "full" ? "pass" : "warn",
      detail: getExportRedactionMode(session) === "full" ? "Full redaction is active for this export." : "Use `--redaction full` before sharing outside your trusted team.",
    },
  ];

  const topEvidence = uniqueNonEmpty(
    model.byKind.blocker.concat(model.byKind.finding).map((item) => item.text)
      .concat(failedCommands.map((item) => `Failed command: ${item.command}${renderExitText(item)}`))
      .concat(browserSignals.map((item) => item.text))
      .concat(model.snapshots.slice(-3).map((item) => `${item.snapshotKind || "snapshot"}: ${item.note || item.storedPath || "captured"}`))
  ).slice(0, 6);

  return {
    score,
    scoreLabel,
    scoreDetail,
    checklist,
    topEvidence,
    aiPrompt: buildAiHandoffPrompt(session, model, topEvidence),
  };
}

function buildAiHandoffPrompt(session, model, topEvidence) {
  const lines = [];
  const failedCommands = model.commands.filter((item) => item.exitCode !== null && item.exitCode !== undefined && item.exitCode !== 0);
  lines.push("You are reviewing a local Tracepad debugging session. Produce a concise engineering handoff with: summary, timeline comparison, confirmed findings, hypotheses, likely root cause, missing evidence, and next checks.");
  lines.push("");
  lines.push(`Session: ${session.title}`);
  lines.push(`Status: ${session.status}`);
  lines.push(`Branch: ${session.branch || "unknown"}`);
  lines.push(`Summary: ${session.summary || model.summaryFallback}`);
  lines.push("");
  lines.push("Priority evidence:");
  appendNumberedPromptLines(lines, topEvidence.length > 0 ? topEvidence : ["No priority evidence captured yet."]);
  lines.push("");
  lines.push("Findings:");
  appendNumberedPromptLines(lines, model.byKind.finding.concat(model.byKind.blocker).map((item) => item.text).slice(0, 8));
  lines.push("");
  lines.push("Hypotheses:");
  appendNumberedPromptLines(lines, model.byKind.hypothesis.map((item) => item.text).slice(0, 8));
  lines.push("");
  lines.push("Decisions:");
  appendNumberedPromptLines(lines, model.byKind.decision.map((item) => item.text).slice(0, 8));
  lines.push("");
  lines.push("Failed commands:");
  appendNumberedPromptLines(lines, failedCommands.map((item) => `${item.command}${renderExitText(item)}${item.note ? ` - ${item.note}` : ""}`).slice(0, 8));
  lines.push("");
  lines.push("Evidence artifacts:");
  appendNumberedPromptLines(lines, model.evidenceLines.slice(0, 10).map((item) => item.replace(/^- /, "")));
  return lines.join("\n");
}

function appendNumberedPromptLines(lines, values) {
  const items = values && values.length > 0 ? values : ["None captured."];
  for (let index = 0; index < items.length; index += 1) {
    lines.push(`${index + 1}. ${items[index]}`);
  }
}

function renderHtmlSection(title, lines, emptyText) {
  const content = lines.length > 0 ? `<ul class="note-list">${lines.map((line) => `<li>${line}</li>`).join("")}</ul>` : `<p class="empty-state">${escapeHtml(emptyText || "No data.")}</p>`;
  return `<section class="section"><div class="section-header"><div><h2>${escapeHtml(title)}</h2></div></div>${content}</section>`;
}

function renderHtmlExecutivePanel(session, model) {
  const topSignals = model.byKind.blocker.concat(model.byKind.finding).slice(0, 5);
  const decisions = model.byKind.decision.slice(-4);
  const signalItems = topSignals.length > 0
    ? topSignals.map((item) => `<li class="${escapeHtml(item.kind)}">${renderHtmlNoteItem(item)}</li>`).join("")
    : `<li><span class="muted">No high-signal findings captured yet.</span></li>`;
  const decisionItems = decisions.length > 0
    ? decisions.map((item) => `<li class="${escapeHtml(item.kind)}">${renderHtmlNoteItem(item)}</li>`).join("")
    : `<li><span class="muted">No decisions or mitigations captured yet.</span></li>`;

  return `<section class="section" id="insights">
    <div class="section-header">
      <div>
        <h2>Investigation Brief</h2>
        <p class="section-subtitle">The fastest read for reviewers joining the debug session.</p>
      </div>
    </div>
    <div class="grid-2">
      <div>
        <h3 class="eyebrow" style="color: var(--rose); margin-bottom: 8px;">Top Signals</h3>
        <ul class="note-list">${signalItems}</ul>
      </div>
      <div>
        <h3 class="eyebrow" style="color: var(--green); margin-bottom: 8px;">Decisions</h3>
        <ul class="note-list">${decisionItems}</ul>
      </div>
    </div>
  </section>`;
}

function renderHtmlInsightPanel(model) {
  const insights = buildSuggestedInsights(model);
  const cards = [
    { title: "Comparison", items: insights.comparison, className: "context" },
    { title: "Findings", items: insights.findings, className: "finding" },
    { title: "Hypotheses", items: insights.hypotheses, className: "hypothesis" },
    { title: "Next Checks", items: insights.nextChecks, className: "decision" },
  ];

  return `<section class="section">
    <div class="section-header">
      <div>
        <h2>Suggested Insights</h2>
        <p class="section-subtitle">Local history-based suggestions for comparison, findings, hypotheses, and next checks. No data leaves this machine.</p>
      </div>
    </div>
    <div class="insight-grid">
      ${cards.map((card) => `<article class="insight-card">
        <span class="badge ${escapeHtml(card.className)}">${escapeHtml(card.title)}</span>
        <ul>${card.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>`).join("")}
    </div>
  </section>`;
}

function buildSuggestedInsights(model) {
  const findings = model.byKind.blocker.concat(model.byKind.finding).map((item) => item.text);
  const hypotheses = model.byKind.hypothesis.map((item) => item.text);
  const decisions = model.byKind.decision.map((item) => item.text);
  const browserSignals = findings.filter((text) => /browser|console|network|status \d{3}|selected:|http/i.test(text));
  const failedCommands = model.commands.filter((item) => item.exitCode !== null && item.exitCode !== undefined && item.exitCode !== 0);
  const browserTabs = model.byKind.context.filter((item) => item.text && item.text.startsWith("Browser tab:"));
  const evidenceCount = model.snapshots.length + model.attachments.length;

  const comparison = [
    `${browserSignals.length} browser signal(s), ${failedCommands.length} failed command(s), and ${evidenceCount} evidence artifact(s) were captured.`,
  ];
  if (browserTabs.length > 0) {
    comparison.push(`${browserTabs.length} browser context tab(s) connect the timeline to dashboard or app state.`);
  }
  if (model.snapshots.length > 0) {
    comparison.push(`${model.snapshots.length} snapshot(s) can be compared against findings to explain what changed.`);
  }

  const suggestedFindings = uniqueNonEmpty(findings).slice(0, 4);
  if (suggestedFindings.length === 0 && failedCommands.length > 0) {
    suggestedFindings.push(`${failedCommands.length} command(s) exited non-zero and need review.`);
  }
  if (suggestedFindings.length === 0 && browserSignals.length > 0) {
    suggestedFindings.push("Browser capture contains failed network or console signals.");
  }
  if (suggestedFindings.length === 0) {
    suggestedFindings.push("No explicit findings yet. Add findings as soon as a signal is confirmed.");
  }

  const suggestedHypotheses = uniqueNonEmpty(hypotheses).slice(0, 4);
  if (suggestedHypotheses.length === 0 && browserSignals.length > 0 && browserTabs.length > 0) {
    suggestedHypotheses.push("Correlate the failed browser signal with the captured dashboard or app tab state.");
  }
  if (suggestedHypotheses.length === 0 && failedCommands.length > 0) {
    suggestedHypotheses.push("The failing command output may identify the narrowest reproduction path.");
  }
  if (suggestedHypotheses.length === 0) {
    suggestedHypotheses.push("No hypothesis captured yet. Add one before closing the session.");
  }

  const nextChecks = [];
  if (decisions.length > 0) {
    nextChecks.push(`Verify the latest decision: ${decisions[decisions.length - 1]}`);
  }
  if (browserSignals.length > 0) {
    nextChecks.push("Re-run the failing browser path after the suspected fix and capture the new status.");
  }
  if (failedCommands.length > 0) {
    nextChecks.push("Re-run failed commands and record pass/fail outcomes before handoff.");
  }
  if (model.snapshots.length === 0) {
    nextChecks.push("Capture a git diff snapshot so reviewers can compare evidence with code changes.");
  }
  if (nextChecks.length === 0) {
    nextChecks.push("Add a final summary with `tracepad stop \"...\"` before sharing.");
  }

  return {
    comparison: comparison.slice(0, 4),
    findings: suggestedFindings.slice(0, 4),
    hypotheses: suggestedHypotheses.slice(0, 4),
    nextChecks: uniqueNonEmpty(nextChecks).slice(0, 4),
  };
}

function collectBrowserSignals(model) {
  return model.byKind.finding
    .concat(model.byKind.context)
    .filter((item) => /browser|console|network|status \d{3}|selected:|http|grafana|argocd|openshift|kubernetes|ci\/cd|dashboard/i.test(item.text || ""));
}

function renderHtmlBrowserBoard(model) {
  const browserTabs = model.byKind.context
    .filter((item) => item.text && item.text.startsWith("Browser tab:"))
    .map((item) => parseBrowserTabNote(item.text));
  const hasBrowserSummary = model.snapshots.some((item) => item.snapshotKind === "browser-capture-summary");
  const browserSignals = collectBrowserSignals(model).slice(0, 6);

  if (!hasBrowserSummary && browserTabs.length === 0 && browserSignals.length === 0) {
    return "";
  }

  const tabCards = browserTabs.length > 0
    ? browserTabs.slice(0, 6).map((tab) => `<article class="browser-card">
        <strong>${escapeHtml(tab.title)}</strong>
        <p>${escapeHtml(tab.url || "No URL captured")}</p>
      </article>`).join("")
    : `<div class="empty-state">No browser tabs were captured in this session.</div>`;

  const signalList = browserSignals.length > 0
    ? `<ul class="note-list">${browserSignals.map((item) => `<li class="finding">${renderHtmlNoteItem(item)}</li>`).join("")}</ul>`
    : `<p class="empty-state">No console, selection, or failed network findings were captured.</p>`;

  return `<section class="section" id="browser">
    <div class="section-header">
      <div>
        <h2>Browser Evidence Board</h2>
        <p class="section-subtitle">Tabs, dashboard context, console errors, failed requests, and selected text in one place.</p>
      </div>
    </div>
    <div class="grid-2">
      <div>
        <h3 class="eyebrow" style="color: var(--blue); margin-bottom: 8px;">Captured Tabs</h3>
        <div class="browser-grid">${tabCards}</div>
      </div>
      <div>
        <h3 class="eyebrow" style="color: var(--rose); margin-bottom: 8px;">Browser Signals</h3>
        ${signalList}
      </div>
    </div>
  </section>`;
}

function renderHtmlEvidenceGrid(session, model) {
  const evidence = model.snapshots.concat(model.attachments);
  if (evidence.length === 0) {
    return renderHtmlSection("Evidence", [], "No snapshots or attachments captured yet.");
  }

  const cards = evidence.map((item) => {
    const isAttachment = item.type === "attachment";
    const label = isAttachment ? "attachment" : item.snapshotKind || "snapshot";
    const pathText = item.storedPath || item.originalPath || "unknown";
    const preview = renderHtmlArtifactPreview(session, item);
    return `<article class="evidence-card">
      <span class="badge ${isAttachment ? "attachment" : "snapshot"}">${escapeHtml(label)}</span>
      <strong>${escapeHtml(item.note || label)}</strong>
      <p><code>${escapeHtml(pathText)}</code></p>
      ${preview}
    </article>`;
  }).join("");

  return `<section class="section" id="evidence">
    <div class="section-header">
      <div>
        <h2>Evidence</h2>
        <p class="section-subtitle">Artifacts copied into Tracepad for review and handoff.</p>
      </div>
    </div>
    <div class="evidence-grid">${cards}</div>
  </section>`;
}

function renderHtmlArtifactPreview(session, item) {
  if (!item.storedPath || !/\.(png|jpe?g|webp|gif)$/i.test(item.storedPath)) {
    return "";
  }
  if (getExportRedactionMode(session) === "full") {
    return `<p class="empty-state">Image preview hidden by full redaction mode. Use a normal local export when screenshot pixels are needed for debugging.</p>`;
  }
  const artifactPath = path.resolve(session.repoRoot || process.cwd(), item.storedPath);
  const dataUrl = readImageAsDataUrl(artifactPath, 1200000);
  if (!dataUrl) {
    return "";
  }
  const label = item.note || "Tracepad artifact";
  return `<button type="button" class="image-preview-button" data-src="${escapeHtml(dataUrl)}" data-alt="${escapeHtml(label)}" onclick="openImagePreview(this.dataset.src, this.dataset.alt)" title="Open and zoom screenshot">
    <img class="artifact-image" alt="${escapeHtml(label)}" src="${escapeHtml(dataUrl)}" />
  </button>`;
}

function readImageAsDataUrl(filePath, maxBytes) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return "";
  }
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) {
    return "";
  }
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg"
    ? "image/jpeg"
    : extension === ".webp"
      ? "image/webp"
      : extension === ".gif"
        ? "image/gif"
        : "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function renderHtmlTimelineCards(session) {
  const events = Array.isArray(session.events) ? session.events : [];
  if (events.length === 0) {
    return renderHtmlSection("Timeline", [], "No timeline captured yet.");
  }

  const filters = buildTimelineFilters(events);
  const buttons = filters.map((filter) => `<button type="button" data-filter="${escapeHtml(filter.kind)}" class="${filter.kind === "all" ? "active" : ""}" onclick="filterTimeline('${escapeHtml(filter.kind)}')">${escapeHtml(formatEventKindLabel(filter.kind))} <span class="muted">${escapeHtml(String(filter.count))}</span></button>`).join("");
  const cards = events.map((event) => {
    const kind = classifyHtmlEventKind(event);
    const kinds = timelineEventKinds(event).join(" ");
    const searchText = renderTimelineSearchText(event);
    return `<article class="timeline-card" data-event-kind="${escapeHtml(kind)}" data-event-kinds="${escapeHtml(kinds)}" data-search="${escapeHtml(searchText)}">
      <div class="time">${escapeHtml(formatElapsedTime(session.createdAt, event.at))}<br><span>${escapeHtml(formatDisplayTime(event.at))}</span></div>
      <div class="content">
        <div class="event-title">
          <span class="badge ${escapeHtml(kind)}">${escapeHtml(formatEventKindLabel(kind))}</span>
          <span class="muted">${escapeHtml(event.type || "event")}</span>
        </div>
        <p class="event-text">${renderHtmlEventBody(event)}</p>
      </div>
    </article>`;
  }).join("");

  return `<section class="section" id="timeline">
    <div class="section-header">
      <div>
        <h2>Timeline</h2>
        <p class="section-subtitle">Filter the session by signal type while reviewing the handoff.</p>
      </div>
    </div>
    <div class="timeline-toolbar">
      <div class="timeline-controls">${buttons}</div>
      <input id="timelineSearch" class="timeline-search" type="search" placeholder="Search timeline" oninput="applyTimelineFilters()" />
    </div>
    <div class="timeline-list">${cards}</div>
  </section>`;
}

function renderTimelineSearchText(event) {
  return [
    event.type,
    event.kind,
    event.text,
    event.command,
    event.note,
    event.snapshotKind,
    event.storedPath,
    event.originalPath,
    event.state,
  ].filter(Boolean).join(" ");
}

function renderHtmlNoteItem(item) {
  return `<span class="note-meta">${escapeHtml(formatDisplayTime(item.at))} - ${escapeHtml(item.kind || "note")}</span>${escapeHtml(item.text || "")}`;
}

function renderHtmlCommandItem(item) {
  const status = item.exitCode === null || item.exitCode === undefined ? "unknown" : item.exitCode === 0 ? "pass" : "failed";
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span> <code>${escapeHtml(item.command)}</code>${escapeHtml(renderExitText(item))}${item.note ? ` <span class="muted">- ${escapeHtml(item.note)}</span>` : ""}`;
}

function renderHtmlEventBody(event) {
  if (event.type === "note") {
    return escapeHtml(event.text || "");
  }
  if (event.type === "command") {
    return `${renderHtmlCommandItem(event)}`;
  }
  if (event.type === "attachment") {
    return `${event.note ? `${escapeHtml(event.note)} ` : ""}<code>${escapeHtml(event.storedPath || event.originalPath || "")}</code>`;
  }
  if (event.type === "snapshot") {
    return `${escapeHtml(event.snapshotKind || "snapshot")} <code>${escapeHtml(event.storedPath || "")}</code>${event.note ? ` <span class="muted">- ${escapeHtml(event.note)}</span>` : ""}`;
  }
  if (event.type === "status") {
    return `${escapeHtml(event.state || "unknown")}${event.note ? ` <span class="muted">- ${escapeHtml(event.note)}</span>` : ""}`;
  }
  return escapeHtml(renderEventLine(event, event.at));
}

function classifyHtmlEventKind(event) {
  if (event.type === "command") {
    return event.exitCode !== null && event.exitCode !== undefined && event.exitCode !== 0 ? "failed" : "command";
  }
  if (event.type === "note") {
    return event.kind || "note";
  }
  if (event.type === "snapshot") {
    return "snapshot";
  }
  if (event.type === "attachment") {
    return "attachment";
  }
  return event.type || "event";
}

function buildTimelineFilters(events) {
  const counts = { all: events.length };
  for (const event of events) {
    for (const kind of timelineEventKinds(event)) {
      counts[kind] = (counts[kind] || 0) + 1;
    }
  }

  const order = ["all", "finding", "hypothesis", "context", "browser", "command", "failed", "evidence", "snapshot", "attachment", "decision", "blocker", "status"];
  const ordered = order.filter((kind) => counts[kind] > 0).map((kind) => ({ kind, count: counts[kind] }));
  const extras = Object.keys(counts)
    .filter((kind) => !order.includes(kind) && counts[kind] > 0)
    .sort()
    .map((kind) => ({ kind, count: counts[kind] }));
  return ordered.concat(extras);
}

function timelineEventKinds(event) {
  const kinds = new Set([classifyHtmlEventKind(event)]);
  if (event.type === "snapshot" || event.type === "attachment") {
    kinds.add("evidence");
  }
  if (event.type === "command") {
    kinds.add("command");
    if (event.exitCode !== null && event.exitCode !== undefined && event.exitCode !== 0) {
      kinds.add("failed");
    }
  }
  if (event.type === "note" && /browser|console|network|status \d{3}|selected:|http|grafana|argocd|openshift|kubernetes/i.test(event.text || "")) {
    kinds.add("browser");
  }
  if (event.type === "status") {
    kinds.add("status");
  }
  return Array.from(kinds).filter(Boolean);
}

function formatEventKindLabel(kind) {
  return String(kind || "event").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseBrowserTabNote(text) {
  const raw = String(text || "").replace(/^Browser tab:\s*/i, "");
  const parts = raw.split(" | ");
  return {
    title: parts[0] || "(untitled)",
    url: parts.slice(1).join(" | "),
  };
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    output.push(text);
  }
  return output;
}

function renderHtmlDiffSnapshots(session, model) {
  if (getExportRedactionMode(session) === "full") {
    return renderHtmlSection("Diff Viewer", [], "Diff previews are hidden by full redaction mode. Use a normal local export when code context is needed for debugging.");
  }
  const diffSnapshots = model.snapshots.filter((item) =>
    ["git-diff", "git-diff-staged", "git-show"].includes(item.snapshotKind)
  );
  if (diffSnapshots.length === 0) {
    return renderHtmlSection("Diff Viewer", [], "No git diff snapshots captured yet.");
  }

  const blocks = diffSnapshots.map((item) => {
    const artifactPath = path.resolve(session.repoRoot || process.cwd(), item.storedPath);
    const diffText = readTextIfSmall(artifactPath, 300000);
    const rendered = diffText ? renderInlineDiff(diffText) : `<p class="muted">Diff artifact unavailable: ${escapeHtml(item.storedPath)}</p>`;
    return `<details class="diff-file" open>
      <summary>${escapeHtml(item.snapshotKind)} - <code>${escapeHtml(item.storedPath)}</code>${item.note ? ` <span class="muted">- ${escapeHtml(item.note)}</span>` : ""}</summary>
      ${rendered}
    </details>`;
  });

  return `<section class="section"><h2>Diff Viewer</h2>${blocks.join("\n")}</section>`;
}

function renderInlineDiff(diffText) {
  const lines = String(diffText).split(/\r?\n/);
  const rendered = lines.map((line, index) => {
    const className = classifyDiffLine(line);
    return `<div class="diff-line ${className}"><span class="ln">${index + 1}</span><span class="code">${escapeHtml(line || " ")}</span></div>`;
  });
  return `<pre class="diff-view">${rendered.join("")}</pre>`;
}

function classifyDiffLine(line) {
  if (line.startsWith("@@")) {
    return "diff-hunk";
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "diff-add";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "diff-del";
  }
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---")) {
    return "diff-meta";
  }
  return "";
}

function renderCliStart(session) {
  const lines = [
    `Started session ${session.id}: ${session.title}`,
    `Status: ${session.status}`,
    `Branch: ${session.branch || "unknown"}`,
    `Created: ${formatDisplayTime(session.createdAt)}`,
    "",
    "Run your normal terminal commands now.",
    "If shell capture is installed, Tracepad records commands automatically.",
    "",
    "Useful next commands:",
    "  tracepad note \"What I observed\" --kind finding",
    "  tracepad status",
    "  tracepad stop \"Root cause or final summary\"",
  ];
  return `${renderCliPanel("Tracepad Session Started", lines)}\n`;
}

function renderCliStatus(session) {
  const summary = summarizeSession(session);
  const model = buildSessionModel(session);
  const lines = [
    `Session: ${session.id}`,
    `Title: ${session.title}`,
    `Status: ${session.status}`,
    `Created: ${formatDisplayTime(session.createdAt)}`,
    `Updated: ${formatDisplayTime(session.updatedAt)}`,
  ];
  if (session.branch) {
    lines.push(`Branch: ${session.branch}`);
  }
  lines.push("");
  lines.push("Metrics:");
  lines.push(`  Events: ${session.events.length}`);
  lines.push(`  Notes: ${summary.noteCount}`);
  lines.push(`  Commands: ${summary.commandCount}`);
  lines.push(`  Attachments: ${summary.attachmentCount}`);
  lines.push(`  Snapshots: ${summary.snapshotCount}`);
  lines.push(`  Failing cmds: ${summary.failingCommandCount}`);
  lines.push(`  Decisions: ${summary.decisionCount}`);
  lines.push("");
  lines.push("Brief:");
  lines.push(`  ${session.summary || model.summaryFallback}`);
  lines.push("");
  lines.push("Recent timeline:");

  const recent = session.events.slice(-8);
  if (recent.length === 0) {
    lines.push("  - none");
  } else {
    for (const event of recent) {
      lines.push(`  - ${renderEventLine(event, session.createdAt)}`);
    }
  }

  lines.push("");
  lines.push("Next:");
  if (session.status === "active") {
    lines.push("  tracepad note \"New finding\" --kind finding");
    lines.push("  tracepad stop \"Final summary\"");
  } else {
    lines.push(`  tracepad export ${session.id} --format html --template postmortem --output incident.html`);
  }

  return `${renderCliPanel(`${TOOL_NAME} Status`, lines)}\n`;
}

function renderCliStop(session, outputPath, redaction) {
  const summary = summarizeSession(session);
  const lines = [
    `Stopped session ${session.id}: ${session.title}`,
    `Captured ${session.events.length} event(s), ${summary.commandCount} command(s), ${summary.noteCount} note(s), ${summary.snapshotCount} snapshot(s).`,
    `Redaction: ${redaction || "normal"}`,
    `Visual report: ${outputPath}`,
    "",
    "Review:",
    "  open the visual report path above",
    `  tracepad status ${session.id}`,
  ];
  return `${renderCliPanel("Tracepad Session Complete", lines)}\n`;
}

function renderCliPanel(title, lines) {
  const width = Math.max(72, Math.min(process.stdout.columns || 96, 120));
  const wrapped = [];
  for (const line of lines) {
    if (line === "") {
      wrapped.push("");
      continue;
    }
    wrapped.push(...wrapCliLine(line, width - 4));
  }
  return drawBox(title, wrapped, width);
}

function wrapCliLine(line, width) {
  const text = String(line);
  if (text.length <= width) {
    return [text];
  }

  const indent = (/^\s*/.exec(text) || [""])[0];
  const continuationIndent = indent || "  ";
  const words = text.trim().split(/\s+/).filter(Boolean);
  const output = [];
  let current = indent;

  for (const word of words) {
    const separator = current.trim() ? " " : "";
    const candidate = `${current}${separator}${word}`;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }

    if (current.trim()) {
      output.push(current);
      current = continuationIndent;
    }

    if (`${current}${word}`.length <= width) {
      current = `${current}${word}`;
      continue;
    }

    const available = Math.max(12, width - continuationIndent.length);
    const chunks = chunkLongText(word, available);
    for (let index = 0; index < chunks.length - 1; index += 1) {
      output.push(`${continuationIndent}${chunks[index]}`);
    }
    current = `${continuationIndent}${chunks[chunks.length - 1]}`;
  }

  if (current.trim()) {
    output.push(current);
  }
  return output.length > 0 ? output : [text.slice(0, width)];
}

function chunkLongText(value, size) {
  const chunks = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks.length > 0 ? chunks : [value];
}

function renderTuiScreen(session, flashMessage, uiState) {
  const summary = summarizeSession(session);
  const width = Math.max(72, Math.min(process.stdout.columns || 120, 120));
  const innerWidth = width - 4;
  const visibleEvents = session.events.slice(-8);
  const selectedIndex = uiState && Number.isFinite(uiState.selectedIndex) ? uiState.selectedIndex : 0;
  const timelineLines = visibleEvents.length > 0
    ? visibleEvents.map((event, index) => `${index === selectedIndex ? ">" : " "} ${renderEventLine(event, session.createdAt)}`)
    : ["No events captured yet."];
  const preview = uiState && uiState.preview ? uiState.preview : { title: "Preview", lines: ["No preview available."], offset: 0, totalLines: 1 };

  const lines = [];
  lines.push("\x1b[?25l\x1b[2J\x1b[H");
  lines.push(`${ANSI.cyan}${ANSI.bold}Tracepad${ANSI.reset} ${ANSI.gray}debugging flight recorder${ANSI.reset}`);
  lines.push(`${ANSI.bold}${session.title}${ANSI.reset}`);
  lines.push(`${ANSI.gray}Session ${session.id} | ${session.status} | ${session.branch || "no-branch"}${ANSI.reset}`);
  lines.push("");
  lines.push([
    metricCard("Notes", summary.noteCount, "cyan"),
    metricCard("Commands", summary.commandCount, "green"),
    metricCard("Snapshots", summary.snapshotCount, "yellow"),
    metricCard("Failures", summary.failingCommandCount, "red"),
  ].join("   "));
  lines.push("");
  if (flashMessage) {
    lines.push(`${ANSI.green}${flashMessage}${ANSI.reset}`);
    lines.push("");
  }
  lines.push(drawBox("Summary", wrapLines(session.summary || summarizeForDisplay(session), innerWidth), width));
  lines.push("");
  lines.push(
    renderSplitBoxes(
      "Recent Timeline",
      wrapLines(timelineLines.join("\n"), Math.max(20, Math.floor((width - 7) / 2) - 4)),
      preview.title,
      wrapLines(preview.lines.join("\n"), Math.max(20, Math.ceil((width - 7) / 2) - 4)),
      width
    )
  );
  lines.push("");
  lines.push(
    `${ANSI.gray}Keys: q quit | r refresh | e export HTML | d capture diff | n quick note | [ ] select event | j k scroll preview${ANSI.reset}`
  );
  return lines.join("\n");
}

function metricCard(label, value, colorName) {
  const color = ANSI[colorName] || ANSI.cyan;
  return `${color}${ANSI.bold}${String(value).padStart(2, " ")}${ANSI.reset} ${ANSI.gray}${label}${ANSI.reset}`;
}

function drawBox(title, lines, width) {
  const innerWidth = width - 4;
  const label = `- ${title} `;
  const top = `+${label}${"-".repeat(Math.max(0, width - 2 - label.length))}+`;
  const content = lines.map((line) => `| ${padRight(line, innerWidth)} |`);
  const bottom = `+${"-".repeat(width - 2)}+`;
  return [top, ...content, bottom].join("\n");
}

function drawBoxLines(title, lines, width) {
  const innerWidth = width - 4;
  const safeLines = lines.length > 0 ? lines : [""];
  const label = `- ${title} `;
  const top = `+${label}${"-".repeat(Math.max(0, width - 2 - label.length))}+`;
  const content = safeLines.map((line) => `| ${padRight(line, innerWidth)} |`);
  const bottom = `+${"-".repeat(width - 2)}+`;
  return [top, ...content, bottom];
}

function renderSplitBoxes(leftTitle, leftLines, rightTitle, rightLines, width) {
  const leftWidth = Math.max(30, Math.floor((width - 3) / 2));
  const rightWidth = Math.max(30, width - leftWidth - 3);
  const leftBox = drawBoxLines(leftTitle, leftLines, leftWidth);
  const rightBox = drawBoxLines(rightTitle, rightLines, rightWidth);
  const totalLines = Math.max(leftBox.length, rightBox.length);
  const output = [];

  for (let index = 0; index < totalLines; index += 1) {
    const left = leftBox[index] || `| ${" ".repeat(leftWidth - 4)} |`;
    const right = rightBox[index] || `| ${" ".repeat(rightWidth - 4)} |`;
    output.push(`${left} ${right}`);
  }

  return output.join("\n");
}

function summarizeForDisplay(session) {
  const items = session.events.filter((event) => event.type === "note" && (event.kind === "finding" || event.kind === "decision"));
  if (items.length === 0) {
    return "No executive summary yet. Add findings, decisions, or close the session with --summary.";
  }
  return items.slice(-3).map((item) => `[${item.kind}] ${item.text}`).join(" | ");
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

function renderEventLine(event, sessionStartAt) {
  const prefix = sessionStartAt ? `[${formatElapsedTime(sessionStartAt, event.at)}] ` : "";
  if (event.type === "note") {
    return `${prefix}${event.kind.toUpperCase()} | ${event.text}`;
  }
  if (event.type === "command") {
    const exitText = event.exitCode === null ? "exit ?" : `exit ${event.exitCode}`;
    const source = event.source === "history" ? "CMD/HISTORY" : "CMD";
    return `${prefix}${source} | ${event.command} | ${exitText}`;
  }
  if (event.type === "attachment") {
    return `${prefix}ATTACHMENT | ${event.storedPath}`;
  }
  if (event.type === "snapshot") {
    return `${prefix}SNAPSHOT | ${event.snapshotKind} | ${event.storedPath}`;
  }
  if (event.type === "status") {
    return `${prefix}STATUS | ${event.state}`;
  }
  return `${prefix}${event.type.toUpperCase()}`;
}

function buildTuiPreview(repoRoot, session, event, requestedOffset) {
  if (!event) {
    return { title: "Preview", lines: ["No preview available."], offset: 0, totalLines: 1 };
  }

  let title = `${event.type.toUpperCase()} Preview`;
  let sourceLines = [];

  if (event.type === "note") {
    title = `${event.kind.toUpperCase()} Preview`;
    sourceLines = [event.text];
  } else if (event.type === "command") {
    sourceLines = [
      `Command: ${event.command}`,
      `Exit: ${event.exitCode === null || event.exitCode === undefined ? "unknown" : event.exitCode}`,
      `Source: ${event.source || "manual"}`,
    ];
    if (event.note) {
      sourceLines.push("", `Note: ${event.note}`);
    }
  } else if (event.type === "attachment" || event.type === "snapshot") {
    const storedPath = event.storedPath ? path.resolve(repoRoot, event.storedPath) : "";
    const header = [
      `Stored: ${event.storedPath || "n/a"}`,
      event.snapshotKind ? `Kind: ${event.snapshotKind}` : "",
      event.note ? `Note: ${event.note}` : "",
      "",
    ].filter(Boolean);

    if (storedPath && fs.existsSync(storedPath) && fs.statSync(storedPath).isFile()) {
      const content = fs.readFileSync(storedPath, "utf8").split(/\r?\n/);
      sourceLines = header.concat(content);
    } else {
      sourceLines = header.concat(["Artifact content unavailable."]);
    }
  } else if (event.type === "status") {
    sourceLines = [`State: ${event.state || "unknown"}`];
    if (event.note) {
      sourceLines.push("", `Note: ${event.note}`);
    }
  } else {
    sourceLines = [JSON.stringify(event, null, 2)];
  }

  const offset = Math.max(0, Math.min(Number(requestedOffset) || 0, Math.max(0, sourceLines.length - 1)));
  return {
    title,
    lines: sourceLines.slice(offset, offset + 18),
    offset,
    totalLines: sourceLines.length,
  };
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
    timelineLines.push(`- ${renderEventLine(event, session.createdAt)}`);
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
    timelineLines,
    evidenceLines,
    summaryFallback,
  };
}

function renderReplay(session, format) {
  const commands = session.events.filter((event) => event.type === "command");
  if (commands.length === 0) {
    return format === "markdown" ? "No commands recorded yet." : "# No commands recorded yet.";
  }

  if (format === "markdown") {
    const lines = ["## Replay Commands", ""];
    for (const item of commands) {
      lines.push(`- \`${item.command}\`${renderExitText(item)}${item.note ? ` - ${item.note}` : ""}`);
    }
    lines.push("");
    lines.push("```bash");
    for (const item of commands) {
      lines.push(item.command);
    }
    lines.push("```");
    return lines.join("\n");
  }

  const lines = ["#!/usr/bin/env bash", "set -euo pipefail", ""];
  for (const item of commands) {
    if (item.note) {
      lines.push(`# ${item.note}`);
    }
    lines.push(item.command);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function renderExitText(event) {
  if (event.exitCode === null || event.exitCode === undefined) {
    return "";
  }
  return ` (exit ${event.exitCode})`;
}

function appendLines(lines, values) {
  for (const value of values) {
    lines.push(value);
  }
}

function createSession(repoRoot, args, flags) {
  const title = redactText(joinArgs(args) || (flags.title ? String(flags.title).trim() : ""));
  if (!title) {
    fail("Usage: tracepad start \"session title\"");
  }

  const now = isoNow();
  const session = {
    id: createSessionId(),
    title,
    status: "active",
    createdAt: now,
    updatedAt: now,
    repoRoot,
    branch: detectGitBranch(repoRoot),
    startedBy: redactText(process.env.USERNAME || process.env.USER || "unknown"),
    summary: "",
    events: [],
  };

  const initialContext = flags.context ? redactText(String(flags.context).trim()) : "";
  if (initialContext) {
    session.events.push(createEvent("note", { text: initialContext, kind: "context" }));
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
  if (state.activeSessionId) {
    return readSession(repoRoot, state.activeSessionId);
  }

  const branch = detectGitBranch(repoRoot);
  if (branch) {
    const matched = findBranchSession(repoRoot, branch);
    if (matched) {
      setActiveSessionId(repoRoot, matched.id);
      return matched;
    }
  }

  fail("No active session. Start one with: tracepad start \"title\"");
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

function updateGitignore(repoRoot) {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  const begin = "# TRACEPAD BEGIN";
  const end = "# TRACEPAD END";
  const block = [
    begin,
    ".tracepad/state.json",
    ".tracepad/exports/",
    ".tracepad/artifacts/",
    end,
  ].join("\n");

  let existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  existing = existing.replace(new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, "g"), "").trimEnd();
  const next = existing ? `${existing}\n\n${block}\n` : `${block}\n`;
  fs.writeFileSync(gitignorePath, next, "utf8");
}

function renderPluginExport(repoRoot, session, options) {
  const plugin = loadPlugin(repoRoot, "exporters", options.exporter);
  if (!plugin || typeof plugin.exportSession !== "function") {
    fail(`Exporter ${options.exporter} must export exportSession(context).`);
  }

  const output = plugin.exportSession({
    repoRoot,
    session,
    format: options.format,
    template: options.template,
    flags: options.flags,
    helpers: createPluginHelpers(repoRoot, session),
  });

  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

function loadPlugin(repoRoot, kind, name) {
  const safeName = sanitizeFileName(String(name || ""));
  const candidates = [
    path.join(repoRoot, ".tracepad", "plugins", kind, `${safeName}.js`),
    path.join(__dirname, "..", "src", "plugins", kind, `${safeName}.js`),
  ];

  const pluginPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!pluginPath) {
    fail(`Plugin not found: ${kind}/${safeName}.js`);
  }

  return require(pluginPath);
}

function createPluginHelpers(repoRoot, session) {
  return {
    createEvent,
    redactText,
    renderEventLine: (event) => renderEventLine(event, session.createdAt),
    storeArtifactText: (text, fileName) => storeArtifactText(repoRoot, session.id, redactText(text), fileName),
    storeArtifactBuffer: (buffer, fileName) => storeArtifactBuffer(repoRoot, session.id, buffer, fileName),
    readArtifactText: (storedPath, maxBytes) => readTextIfSmall(path.resolve(repoRoot, storedPath), maxBytes || 300000),
    summarizeSession,
  };
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
  return fs
    .readdirSync(sessionsDir(repoRoot), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readJson(path.join(sessionsDir(repoRoot), entry.name)));
}

function touchSession(session) {
  session.updatedAt = isoNow();
}

function findBranchSession(repoRoot, branch) {
  const matches = listSessions(repoRoot)
    .filter((session) => session.branch === branch)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return matches[0] || null;
}

function determineShellName(shellFlag) {
  if (shellFlag === true) {
    return process.platform === "win32" ? "powershell" : process.env.SHELL && process.env.SHELL.includes("zsh") ? "zsh" : "bash";
  }
  const explicit = String(shellFlag || "").trim().toLowerCase();
  if (explicit) {
    return explicit;
  }
  if (process.platform === "win32") {
    return "powershell";
  }
  return process.env.SHELL && process.env.SHELL.includes("zsh") ? "zsh" : "bash";
}

function renderShellIntegration(shell) {
  const cliPath = path.resolve(__filename).replace(/\\/g, "/");
  const nodePath = process.execPath.replace(/\\/g, "/");

  if (shell === "powershell") {
    return `# TRACEPAD BEGIN
$env:TRACEPAD_BIN_PATH = "${cliPath}"
$env:TRACEPAD_NODE_PATH = "${nodePath}"
$global:TracepadLastCommand = ""
function global:prompt {
  $exitCode = if ($global:LASTEXITCODE -is [int]) { $global:LASTEXITCODE } else { 0 }
  $historyItem = Get-History -Count 1 -ErrorAction SilentlyContinue
  if ((Test-Path ".tracepad\\state.json") -and $historyItem -and $historyItem.CommandLine -and $historyItem.CommandLine -ne $global:TracepadLastCommand) {
    $commandText = $historyItem.CommandLine
    $global:TracepadLastCommand = $commandText
    if ($commandText -notmatch 'tracepad(\\.js)?\\s') {
      Start-Process -WindowStyle Hidden -FilePath "$env:TRACEPAD_NODE_PATH" -ArgumentList @("$env:TRACEPAD_BIN_PATH", "cmd", $commandText, "--repo", (Get-Location).Path, "--exit-code", "$exitCode", "--source", "passive-shell") | Out-Null
    }
  }
  "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
}
# TRACEPAD END`;
  }

  if (shell === "zsh") {
    return `# TRACEPAD BEGIN
export TRACEPAD_BIN_PATH="${cliPath}"
export TRACEPAD_NODE_PATH="${nodePath}"
__tracepad_last_command=""
__tracepad_capture_last_command() {
  local exit_code=$?
  [[ -d ".tracepad" && -s ".tracepad/state.json" ]] || return "$exit_code"
  local command_text="$(fc -ln -1 2>/dev/null | sed 's/^ *//')"
  if [ -n "$command_text" ] && [ "$command_text" != "$__tracepad_last_command" ]; then
    __tracepad_last_command="$command_text"
    case "$command_text" in
      tracepad*|*"tracepad.js"*) ;;
      *) ("$TRACEPAD_NODE_PATH" "$TRACEPAD_BIN_PATH" cmd "$command_text" --repo "$PWD" --exit-code "$exit_code" --source passive-shell >/dev/null 2>&1 &) ;;
    esac
  fi
  return "$exit_code"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __tracepad_capture_last_command
# TRACEPAD END`;
  }

  if (shell === "bash") {
    return `# TRACEPAD BEGIN
export TRACEPAD_BIN_PATH="${cliPath}"
export TRACEPAD_NODE_PATH="${nodePath}"
__tracepad_last_command=""
__tracepad_capture_last_command() {
  local exit_code=$?
  [ -d ".tracepad" ] && [ -s ".tracepad/state.json" ] || return "$exit_code"
  local command_text="$(history 1 | sed 's/^[ ]*[0-9]\\+[ ]*//')"
  if [ -n "$command_text" ] && [ "$command_text" != "$__tracepad_last_command" ]; then
    __tracepad_last_command="$command_text"
    case "$command_text" in
      tracepad*|*"tracepad.js"*) ;;
      *) ("$TRACEPAD_NODE_PATH" "$TRACEPAD_BIN_PATH" cmd "$command_text" --repo "$PWD" --exit-code "$exit_code" --source passive-shell >/dev/null 2>&1 &) ;;
    esac
  fi
  return "$exit_code"
}
case "$PROMPT_COMMAND" in
  *__tracepad_capture_last_command*) ;;
  *) PROMPT_COMMAND="__tracepad_capture_last_command\${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
esac
# TRACEPAD END`;
  }

  fail(`Unsupported shell for alias setup: ${shell}`);
}

function resolveShellProfile(shell) {
  const home = os.homedir();
  if (shell === "powershell") {
    const doc = path.join(home, "Documents", "PowerShell");
    fs.mkdirSync(doc, { recursive: true });
    return path.join(doc, "Microsoft.PowerShell_profile.ps1");
  }
  if (shell === "zsh") {
    return path.join(home, ".zshrc");
  }
  if (shell === "bash") {
    return path.join(home, ".bashrc");
  }
  return null;
}

function upsertProfileBlock(profilePath, snippet) {
  const begin = "# TRACEPAD BEGIN";
  const end = "# TRACEPAD END";
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  let existing = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, "utf8") : "";
  existing = existing.replace(new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, "g"), "").trimEnd();
  fs.writeFileSync(profilePath, `${existing ? `${existing}\n\n` : ""}${snippet}\n`, "utf8");
}

function resolveHistoryFile(fileFlag, shell) {
  if (fileFlag) {
    return path.resolve(String(fileFlag));
  }

  const home = os.homedir();
  if (shell === "powershell") {
    const candidates = [
      path.join(home, "AppData", "Roaming", "Microsoft", "Windows", "PowerShell", "PSReadLine", "ConsoleHost_history.txt"),
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
  const matches = String(diffText).match(/^diff --git /gm);
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

function normalizeRedactionMode(value) {
  const mode = String(value || "normal").trim().toLowerCase();
  if (!REDACTION_MODES.has(mode)) {
    fail(`Invalid redaction mode: ${value}. Use normal or full.`);
  }
  return mode;
}

function prepareSessionForExport(session, redactionMode) {
  const mode = normalizeRedactionMode(redactionMode || "normal");
  if (mode === "normal") {
    return tagExportSession(session, mode);
  }

  const copy = redactSessionForFullExport(session);
  return tagExportSession(copy, mode);
}

function tagExportSession(session, mode) {
  try {
    Object.defineProperty(session, EXPORT_REDACTION_MODE, {
      value: normalizeRedactionMode(mode),
      enumerable: false,
      configurable: true,
    });
  } catch (error) {
    // Non-critical: reports can still render without the marker.
  }
  return session;
}

function getExportRedactionMode(session) {
  return normalizeRedactionMode(session && session[EXPORT_REDACTION_MODE] ? session[EXPORT_REDACTION_MODE] : "normal");
}

function redactSessionForFullExport(session) {
  const copy = redactValueForFullExport(session);
  copy.repoRoot = "[REDACTED_REPO_ROOT]";
  copy.branch = copy.branch ? "[REDACTED_BRANCH]" : "";
  copy.startedBy = "[REDACTED_USER]";
  return copy;
}

function redactValueForFullExport(value) {
  if (typeof value === "string") {
    return redactFullText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValueForFullExport(item));
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (typeof item === "string" && (lowerKey.includes("path") || lowerKey === "storedpath" || lowerKey === "originalpath")) {
        output[key] = item && /\.(png|jpe?g|webp|gif)$/i.test(item) ? "[REDACTED_IMAGE].png" : item ? "[REDACTED_PATH]" : "";
      } else {
        output[key] = redactValueForFullExport(item);
      }
    }
    return output;
  }
  return value;
}

function normalizeReplayFormat(value) {
  const format = String(value || "shell").trim().toLowerCase();
  if (!REPLAY_FORMATS.has(format)) {
    fail(`Invalid replay format: ${value}`);
  }
  return format;
}

function ask(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function promptTuiTextInput(input, output, prompt) {
  return new Promise((resolve) => {
    if (typeof input.setRawMode === "function") {
      input.setRawMode(false);
    }
    const rl = readline.createInterface({ input, output });
    rl.question(prompt, (answer) => {
      rl.close();
      if (typeof input.setRawMode === "function") {
        input.setRawMode(true);
      }
      resolve(answer);
    });
  });
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextIfSmall(filePath, maxBytes) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return "";
  }
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) {
    return `File omitted from inline view because it is larger than ${maxBytes} bytes: ${filePath}`;
  }
  return fs.readFileSync(filePath, "utf8");
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

function storeArtifactBuffer(repoRoot, sessionId, buffer, fileName) {
  const targetPath = createArtifactPath(repoRoot, sessionId, fileName);
  fs.writeFileSync(targetPath, buffer);
  return path.relative(repoRoot, targetPath).replace(/\\/g, "/");
}

function defaultExportPath(repoRoot, sessionId, format) {
  const extension = format === "html" ? "html" : format === "json" ? "json" : "md";
  return path.join(exportsDir(repoRoot), `${sessionId}.${extension}`);
}

function openFile(filePath) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", filePath] : [filePath];
  try {
    const child = childProcess.spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch (error) {
    return false;
  }
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

function formatElapsedTime(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `+${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDisplayTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "unknown");
  }
  return date.toLocaleString("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function redactText(value) {
  let text = String(value || "");
  const patterns = [
    { regex: /\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
    { regex: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
    { regex: /\bASIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
    { regex: /\bBearer\s+eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+=/]+\b/gi, replacement: "Bearer [REDACTED_JWT]" },
    { regex: /eyJ[a-zA-Z0-9._-]{20,}/g, replacement: "[REDACTED_TOKEN]" },
    { regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
    { regex: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, replacement: "Bearer [REDACTED_TOKEN]" },
    { regex: /\b(password|passwd|secret|token|access_token|refresh_token|id_token|client_secret|apikey|api_key)\s*=\s*(['"])[^'"]+\2/gi, replacement: "$1=\"[REDACTED_SECRET]\"" },
    { regex: /\b(password|passwd|secret|token|access_token|refresh_token|id_token|client_secret|apikey|api_key)\s*[:=]\s*[^\s'"]+/gi, replacement: "$1=[REDACTED]" },
    { regex: /([?&](?:password|passwd|secret|token|access_token|refresh_token|id_token|client_secret|apikey|api_key)=)[^&#\s]+/gi, replacement: "$1[REDACTED]" },
  ];
  for (const pattern of patterns) {
    text = text.replace(pattern.regex, pattern.replacement);
  }
  return text;
}

function redactFullText(value) {
  let text = redactText(value);
  const patterns = [
    { regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[REDACTED_EMAIL]" },
    { regex: /\bhttps?:\/\/[^\s<>"')]+/gi, replacement: "[REDACTED_URL]" },
    { regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "[REDACTED_IP]" },
    { regex: /(?:^|\s)(\/Users\/|\/home\/|\/var\/folders\/)[^\s<>"')]+/g, replacement: " [REDACTED_PATH]" },
    { regex: /(?:^|\s)[A-Za-z]:\\[^\s<>"')]+/g, replacement: " [REDACTED_PATH]" },
    { regex: /\+\d[\d .()/-]{7,}\d/g, replacement: "[REDACTED_PHONE]" },
  ];
  for (const pattern of patterns) {
    text = text.replace(pattern.regex, pattern.replacement);
  }
  return text.trim();
}

function getClipboardText() {
  try {
    if (process.platform === "darwin") {
      return childProcess.execSync("pbpaste", { encoding: "utf8" });
    }
    if (process.platform === "win32") {
      return childProcess.execSync("powershell -command Get-Clipboard", { encoding: "utf8" });
    }
    try {
      return childProcess.execSync("xclip -selection clipboard -o", { encoding: "utf8" });
    } catch (error) {
      return childProcess.execSync("xsel --clipboard --output", { encoding: "utf8" });
    }
  } catch (error) {
    return "";
  }
}

function extractHighSignalLogSnippet(text, contextLines) {
  const lines = String(text || "").split(/\r?\n/);
  const ranges = [];
  const matcher = /(Exception|Error:|FATAL|Caused by:|HTTP\/\d\.\d"\s5\d\d|status\s5\d\d)/i;
  let matchCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (!matcher.test(lines[index])) {
      continue;
    }
    matchCount += 1;
    ranges.push([Math.max(0, index - contextLines), Math.min(lines.length - 1, index + contextLines)]);
  }

  if (ranges.length === 0) {
    return { matchCount: 0, snippet: "" };
  }

  const merged = [];
  for (const range of ranges) {
    if (merged.length === 0 || range[0] > merged[merged.length - 1][1] + 1) {
      merged.push(range.slice());
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], range[1]);
    }
  }

  const output = [];
  for (let index = 0; index < merged.length; index += 1) {
    const [start, end] = merged[index];
    if (index > 0) {
      output.push("...");
    }
    for (let lineIndex = start; lineIndex <= end; lineIndex += 1) {
      output.push(`${String(lineIndex + 1).padStart(5, " ")} | ${lines[lineIndex]}`);
    }
  }

  return {
    matchCount,
    snippet: output.join("\n"),
  };
}

async function extractHighSignalLogSnippetFromFile(filePath, contextLines, maxMatches) {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const matcher = /(Exception|Error:|FATAL|CRITICAL|Caused by:|HTTP\/\d\.\d"\s5\d\d|status\s5\d\d|failed?)/i;
  const before = [];
  const output = [];
  let lineNumber = 0;
  let matchCount = 0;
  let remainingAfter = 0;
  let truncated = false;

  const pushLine = (number, line, marker) => {
    output.push(`${String(number).padStart(5, " ")} | ${marker || " "} ${line}`);
  };

  for await (const line of rl) {
    lineNumber += 1;
    const matched = matcher.test(line);

    if (matched) {
      matchCount += 1;
      if (matchCount > maxMatches) {
        truncated = true;
        break;
      }

      if (output.length > 0) {
        output.push("...");
      }
      for (const item of before) {
        pushLine(item.number, item.line, " ");
      }
      pushLine(lineNumber, line, ">");
      remainingAfter = contextLines;
      before.length = 0;
      continue;
    }

    if (remainingAfter > 0) {
      pushLine(lineNumber, line, " ");
      remainingAfter -= 1;
      continue;
    }

    before.push({ number: lineNumber, line });
    if (before.length > contextLines) {
      before.shift();
    }
  }

  if (truncated) {
    output.push(`... truncated after ${maxMatches} high-signal match(es)`);
  }

  return {
    matchCount: Math.min(matchCount, maxMatches),
    snippet: output.join("\n"),
  };
}

function installHooks(repoRoot) {
  const gitDir = path.join(repoRoot, ".git");
  if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) {
    fail(`No .git directory found under ${repoRoot}.`);
  }

  const hooksDir = path.join(gitDir, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const nodePath = process.execPath.replace(/\\/g, "/");
  const cliPath = path.resolve(__filename).replace(/\\/g, "/");

  upsertHook(path.join(hooksDir, "post-commit"), [
    'ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
    `"${nodePath}" "${cliPath}" diff --repo "$ROOT" --commit HEAD --note "Auto-captured post-commit snapshot" >/dev/null 2>&1 || true`,
  ]);

  upsertHook(path.join(hooksDir, "post-checkout"), [
    'ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
    `"${nodePath}" "${cliPath}" branch-sync --repo "$ROOT" --create-if-missing >/dev/null 2>&1 || true`,
  ]);
}

function upsertHook(hookPath, lines) {
  const begin = "# TRACEPAD BEGIN";
  const end = "# TRACEPAD END";
  const block = [begin, ...lines, end].join("\n");

  let existing = "";
  if (fs.existsSync(hookPath)) {
    existing = fs.readFileSync(hookPath, "utf8");
    existing = existing.replace(new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, "g"), "").trimEnd();
  }

  const hasShebang = existing.startsWith("#!/bin/sh");
  const parts = [];
  if (!hasShebang) {
    parts.push("#!/bin/sh");
  }
  if (existing) {
    parts.push(existing);
  }
  parts.push(block);

  fs.writeFileSync(hookPath, `${parts.join("\n\n")}\n`, "utf8");
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch (error) {
    // Ignore chmod errors on platforms that do not care.
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  init --shell
      Install passive terminal capture once for this machine.

  start "title"
      Start a debugging session. Then run normal terminal commands.

  stop [summary]
      Close the session and write a visual HTML report.

Commands:
  init [--hooks] [--shell [bash|zsh|powershell]] [--install-shell] [--no-gitignore]
      Create the local .tracepad store in the target repo.
      Add --shell to install passive terminal capture. Add --hooks to install git hook automation.
      Updates .gitignore by default.

  alias setup [--shell bash|zsh|powershell] [--install]
      Print or install shell integration that passively records terminal commands.

  start "title" [--context "why this session exists"]
      Start a new debugging session and make it active.

  record "title" [--context "..."] [--history-limit 12] [--no-history] [--no-status-snapshot]
      One-command debugging flight recorder flow.

  use <session-id>
      Switch the active session.

  branch-sync [--create-if-missing]
      Switch the active session to the current git branch, or create one.

  list
      List known sessions in the repo.

  status [session-id]
      Show a concise session summary. Uses the active session by default.

  tui [session-id]
      Open the visual terminal dashboard. Keys: q quit, r refresh, e export HTML, d diff, n note, [ ] select, j k scroll.

  note "text" [--kind note|finding|hypothesis|decision|blocker|context]
      Append a structured note to the active session.

  cmd "command text" [--exit-code <n>] [--note "result summary"] [--source manual|passive-shell|history]
      Record a command you ran and optional outcome.

  history [--shell powershell|bash|zsh] [--file <history-path>] [--limit <n>]
      Import recent shell commands into the active session.

  parse <log-file> [--context-lines 2] [--max-matches 200] [--note "why this matters"]
      Stream high-signal errors from a large log into a compact snippet.

  replay [session-id] [--format shell|markdown] [--output <file>]
      Reconstruct the recorded command trail for reproduction.

  import <importer-name> [--file <path>] [--note "why this matters"]
      Run an importer plugin from src/plugins/importers or .tracepad/plugins/importers.

  view-browser <browser-capture.json> [--output <file>] [--redaction normal|full] [--no-open]
      Import a browser capture JSON file, generate an HTML report, and open it.

  diff [--staged] [--commit <ref>] [--note "why this diff matters"]
      Capture the current git diff or a committed snapshot into the session artifacts.

  capture
      Start compact interactive capture mode for fast note entry.

  attach <file-path> [--note "why it matters"] [--clip]
      Copy an artifact into .tracepad/artifacts and link it to the session.

  export [session-id] [--format markdown|html|json] [--template handoff|issue|pr|postmortem|slack] [--redaction normal|full] [--exporter <name>] [--output <file>]
      Export the session as a polished brief or through an exporter plugin.

  stop [summary text] [--summary "summary text"] [--format html|markdown|json] [--redaction normal|full] [--output <file>]
      Stop the active session and write a report. Defaults to HTML.

  close [summary text] [--summary "summary text"]
      Close the active session and optionally store a final summary.

Examples:
  tracepad init --shell
  tracepad start "Auth refresh bug"
  npm test
  git diff
  tracepad stop "Root cause was duplicate token refresh"
  tracepad alias setup --shell powershell
  tracepad cmd "npm test" --source passive-shell --exit-code 1
  tracepad attach --clip --note "Stack trace copied from console"
  tracepad parse ./logs/server.log --note "Trimmed fatal error excerpt"
  tracepad replay --format markdown
  tracepad import plain-log --file ./logs/server.log --note "Failure excerpt"
  tracepad import browser-har --file ./debug.har --note "Browser network failures"
  tracepad import browser-capture --file ./browser-capture.json --note "Dashboard/browser investigation"
  tracepad view-browser ./browser-capture.json
  tracepad export --redaction full --format html --output share-safe-incident.html
  tracepad diff --commit HEAD --note "Auto-captured committed changes"
  tracepad export --format html --template postmortem --output incident.html
  tracepad export --format json --output session.json
  tracepad export --template slack --output session-slack.json
  tracepad export --exporter slack --output session-slack.json
`;
}

main().catch((error) => {
  fail(error && error.message ? error.message : String(error));
});
