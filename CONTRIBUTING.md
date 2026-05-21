# Contributing to Tracepad

Tracepad is a zero-dependency local-first CLI. Keep contributions small, inspectable, and useful without hosted infrastructure.

## Project shape

```text
bin/
  tracepad.js          CLI entrypoint
schema/
  session.schema.json  public session format
src/
  plugins/
    importers/         built-in importer plugins
    exporters/         built-in exporter plugins
```

The CLI is intentionally a single executable today so users can run it with `node ./bin/tracepad.js`. New integrations should go through the plugin folders unless they need core session behavior.

## Good first integrations

- importer: Docker container logs
- importer: browser HAR files
- importer: Jest or Maven test reports
- exporter: Jira issue JSON
- exporter: Linear issue Markdown
- exporter: Discord webhook JSON
- exporter: Notion-friendly Markdown

## Importer contract

An importer exports `importSessionData(context)` and returns events to append to the active session.

```js
function importSessionData(context) {
  return {
    events: [
      context.helpers.createEvent("note", {
        kind: "finding",
        text: "Imported finding",
      }),
    ],
  };
}

module.exports = { importSessionData };
```

Run it with:

```bash
node ./bin/tracepad.js import plain-log --file ./server.log
```

## Exporter contract

An exporter exports `exportSession(context)` and returns a string or JSON-serializable value.

```js
function exportSession(context) {
  return JSON.stringify({ title: context.session.title }, null, 2);
}

module.exports = { exportSession };
```

Run it with:

```bash
node ./bin/tracepad.js export --exporter slack --output ./session-slack.json
```

## Rules for contributions

- Keep runtime dependencies at zero unless there is a strong reason.
- Redact secrets before saving or exporting imported text.
- Prefer local files over network calls in the OSS core.
- Add commands to the README when they affect user workflow.
- Keep session JSON compatible with `schema/session.schema.json`.
