# Writing Tracepad Plugins

Tracepad plugins are pure CommonJS modules with a zero-dependency bias. They receive session data plus a small helper API, then return either events to import or content to export.

Built-in plugins live here:

- `src/plugins/importers`
- `src/plugins/exporters`

Repo-local plugins live here:

- `.tracepad/plugins/importers`
- `.tracepad/plugins/exporters`

## Importer Interface

An importer reads an external source and returns Tracepad events.

```js
function importSessionData(context) {
  const storedPath = context.helpers.storeArtifactText(
    "critical log excerpt",
    "critical-log.txt"
  );

  return {
    events: [
      context.helpers.createEvent("snapshot", {
        snapshotKind: "imported-log",
        storedPath,
        changedFiles: 0,
        note: "Imported failure evidence",
      }),
    ],
  };
}

module.exports = { importSessionData };
```

Run it with:

```bash
tracepad import custom-log --file ./server.log
```

## Exporter Interface

An exporter maps a Tracepad session into another tool's payload or document format.

```js
function exportSession(context) {
  return {
    content: `Tracepad session closed: ${context.session.title}`,
  };
}

module.exports = { exportSession };
```

Run it with:

```bash
tracepad export --exporter discord --output discord-payload.json
```

## Context Object

Plugins receive:

- `repoRoot`
- `session`
- `args`
- `flags`
- `helpers`

Useful helpers:

- `createEvent(type, data)`
- `redactText(text)`
- `storeArtifactText(text, fileName)`
- `readArtifactText(storedPath, maxBytes)`
- `renderEventLine(event)`
- `summarizeSession(session)`

## Contribution Targets

Good first plugin PRs:

- Docker container log importer
- browser HAR importer
- Jest or Maven test report importer
- Jira exporter
- Linear exporter
- Discord webhook exporter
- Notion-friendly Markdown exporter
