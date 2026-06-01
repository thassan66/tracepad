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
const REPLAY_FORMATS = new Set(["shell", "markdown"]);
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
  process.stdout.write(`${TOOL_NAME} store ready at ${storeDir(repoRoot)}\n`);
}

function handleAlias(args, flags) {
  const subcommand = firstArg(args);
  if (subcommand !== "setup") {
    fail("Usage: tracepad alias setup [--shell bash|zsh|powershell] [--install]");
  }

  const shell = determineShellName(flags.shell);
  const snippet = renderShellIntegration(shell);
  if (flags.install) {
    const profilePath = resolveShellProfile(shell);
    if (!profilePath) {
      fail(`Cannot auto-install shell integration for ${shell}. Print the snippet and add it manually.`);
    }
    upsertProfileBlock(profilePath, snippet);
    process.stdout.write(`Installed Tracepad shell integration in ${profilePath}\n`);
    return;
  }

  process.stdout.write(`${snippet}\n`);
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
    process.stdout.write("No Tracepad sessions yet.\n");
    return;
  }

  const lines = [`${TOOL_NAME} sessions`];
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

  lines.push(TOOL_NAME);
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

  const recent = session.events.slice(-8);
  if (recent.length === 0) {
    lines.push("  - none");
  } else {
    for (const event of recent) {
      lines.push(`  - ${renderEventLine(event, session.createdAt)}`);
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

function handleExport(repoRoot, args, flags) {
  ensureStore(repoRoot);
  const session = resolveSession(repoRoot, args, flags, { allowPositionalId: true });
  const template = normalizeTemplate(flags.template);
  const format = normalizeFormat(flags.format, flags.output);
  const exporter = flags.exporter || (template === "slack" ? "slack" : "");
  const output = exporter
    ? renderPluginExport(repoRoot, session, { exporter: String(exporter), format, template, flags })
    : renderExport(session, { format, template });
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

  if (format === "json") {
    return `${JSON.stringify(session, null, 2)}\n`;
  }

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
    renderHtmlSection(
      "Commands",
      model.commands.map((item) => `<code>${escapeHtml(item.command)}</code>${escapeHtml(renderExitText(item))}${item.note ? ` <span class="muted">- ${escapeHtml(item.note)}</span>` : ""}`),
      "No commands captured yet."
    ),
    renderHtmlSection(
      "Snapshots",
      model.snapshots.map((item) => `${escapeHtml(item.snapshotKind)} - <code>${escapeHtml(item.storedPath)}</code>${item.note ? ` <span class="muted">- ${escapeHtml(item.note)}</span>` : ""}`),
      "No snapshots captured yet."
    ),
    renderHtmlDiffSnapshots(session, model),
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
      --line: #293648;
      --text: #ebf1f7;
      --muted: #95a5b8;
      --cyan: #56d6ff;
      --green: #62d394;
      --yellow: #ffcf70;
      --rose: #ff8798;
      --red-bg: rgba(255, 135, 152, 0.12);
      --green-bg: rgba(98, 211, 148, 0.12);
      --blue-bg: rgba(86, 214, 255, 0.10);
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
    .section { padding: 18px; margin-bottom: 16px; }
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
    details.diff-file {
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      margin-top: 12px;
      background: rgba(0,0,0,0.18);
    }
    details.diff-file summary {
      cursor: pointer;
      padding: 10px 12px;
      color: var(--text);
      background: rgba(255,255,255,0.04);
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
      border-top: 1px solid rgba(255,255,255,0.04);
    }
    .diff-line .ln {
      color: var(--muted);
      padding: 2px 10px;
      text-align: right;
      user-select: none;
      background: rgba(0,0,0,0.14);
    }
    .diff-line .code {
      white-space: pre;
      padding: 2px 10px;
    }
    .diff-add { background: var(--green-bg); }
    .diff-del { background: var(--red-bg); }
    .diff-hunk { background: var(--blue-bg); color: var(--cyan); }
    .diff-meta { color: var(--muted); }
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
    ${metrics.map((item) => `<article class="metric"><strong>${escapeHtml(String(item.value))}</strong><span>${escapeHtml(item.label)}</span></article>`).join("")}
  </section>`;
}

function renderHtmlSection(title, lines, emptyText) {
  const content = lines.length > 0 ? `<ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul>` : `<p class="muted">${escapeHtml(emptyText || "No data.")}</p>`;
  return `<section class="section"><h2>${escapeHtml(title)}</h2>${content}</section>`;
}

function renderHtmlDiffSnapshots(session, model) {
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

function formatElapsedTime(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `+${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  record "title"
      Start a session, capture git status, import recent shell history, and drop into capture mode.

Commands:
  init [--hooks] [--no-gitignore]
      Create the local .tracepad store in the target repo.
      Add --hooks to install Tracepad git hook automation. Updates .gitignore by default.

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

  diff [--staged] [--commit <ref>] [--note "why this diff matters"]
      Capture the current git diff or a committed snapshot into the session artifacts.

  capture
      Start compact interactive capture mode for fast note entry.

  attach <file-path> [--note "why it matters"] [--clip]
      Copy an artifact into .tracepad/artifacts and link it to the session.

  export [session-id] [--format markdown|html|json] [--template handoff|issue|pr|postmortem|slack] [--exporter <name>] [--output <file>]
      Export the session as a polished brief or through an exporter plugin.

  close [summary text] [--summary "summary text"]
      Close the active session and optionally store a final summary.

Examples:
  tracepad init --hooks
  tracepad alias setup --shell powershell
  tracepad record "Auth refresh bug" --context "User login fails after warm cache"
  tracepad cmd "npm test" --source passive-shell --exit-code 1
  tracepad attach --clip --note "Stack trace copied from console"
  tracepad parse ./logs/server.log --note "Trimmed fatal error excerpt"
  tracepad replay --format markdown
  tracepad import plain-log --file ./logs/server.log --note "Failure excerpt"
  tracepad import browser-har --file ./debug.har --note "Browser network failures"
  tracepad import browser-capture --file ./browser-capture.json --note "Dashboard/browser investigation"
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
