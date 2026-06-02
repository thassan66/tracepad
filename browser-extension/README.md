# Tracepad Browser Capture Extension

This is a no-build Manifest V3 browser extension that records browser debugging evidence and exports the `browser-capture.json` shape supported by Tracepad.

It is intended for Phase 1 capture across generic browser-based tools:

- Grafana
- OpenShift UI
- ArgoCD
- Kubernetes dashboards
- CI/CD pages
- internal admin portals
- application UIs

## Install Locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer Mode.
3. Choose "Load unpacked".
4. Select this folder: `browser-extension`.

Validate the extension files from the repo root:

```bash
npm run extension:validate
```

Build a store-ready zip from the repo root:

```bash
npm run extension:package
```

The zip is written under `dist/`.

## Workflow

Start a Tracepad CLI session in the repo you are investigating:

```bash
tracepad start "Checkout latency spike"
```

In the extension popup:

1. Select **Start**.
2. Debug across browser tabs.
3. Capture selected text when useful.
4. Capture screenshots at important points.
5. Add manual notes.
6. Select **Export**.

## Keyboard Shortcuts

Default shortcuts:

- `Alt+Shift+T`: start or stop browser capture
- `Alt+Shift+S`: capture selected text
- `Alt+Shift+P`: capture visible-tab screenshot
- `Alt+Shift+N`: prompt for a manual note

Additional commands are available without default bindings:

- export capture JSON
- clear capture state

Customize shortcuts in Chrome or Edge:

```text
chrome://extensions/shortcuts
edge://extensions/shortcuts
```

Import the downloaded JSON into Tracepad:

```bash
tracepad view-browser ~/Downloads/tracepad-browser-capture.json
```

For an existing Tracepad session:

```bash
tracepad import browser-capture --file ~/Downloads/tracepad-browser-capture.json
tracepad export --template postmortem --output ./debug-postmortem.md
```

## Captured Evidence

The extension records:

- tab title and URL
- manual notes
- selected text
- visible-tab screenshots
- page errors and unhandled promise rejections
- `console.error` and `console.warn` calls when the page hook can be injected
- failed network requests
- HTTP 4xx and 5xx responses

## Privacy

Recording is explicit and local. The extension stores capture state in browser local storage and exports a JSON file through the browser download flow. It does not upload data to a server.

Review exported JSON and screenshots before sharing. Screenshots and selected text may include private customer, infrastructure, or environment details.

See [STORE_REVIEW.md](STORE_REVIEW.md) for permission justification and manual QA notes.
