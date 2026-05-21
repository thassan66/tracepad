const fs = require("fs");
const path = require("path");
const readline = require("readline");

async function importSessionData(context) {
  const fileFlag = context.flags.file || context.args[0];
  if (!fileFlag) {
    throw new Error("plain-log importer requires --file <path>");
  }

  const sourcePath = path.isAbsolute(fileFlag) ? fileFlag : path.resolve(context.repoRoot, fileFlag);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Log file not found: ${sourcePath}`);
  }

  const contextLines = Number(context.flags["context-lines"] || 2);
  const maxMatches = Number(context.flags["max-matches"] || 200);
  const snippet = await extractHighSignalLines(sourcePath, contextLines, maxMatches);
  if (!snippet.text.trim()) {
    return { events: [] };
  }

  const storedPath = context.helpers.storeArtifactText(snippet.text, `${path.basename(sourcePath)}.imported-snippet.txt`);
  return {
    events: [
      context.helpers.createEvent("snapshot", {
        snapshotKind: "imported-log",
        storedPath,
        changedFiles: snippet.matchCount,
        note: context.helpers.redactText(context.flags.note || "Imported high-signal log excerpt"),
      }),
    ],
  };
}

async function extractHighSignalLines(filePath, contextLines, maxMatches) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
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
    if (matcher.test(line)) {
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
    text: output.join("\n"),
  };
}

module.exports = { importSessionData };
