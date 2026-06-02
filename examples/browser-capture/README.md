# Browser Capture Demo Fixtures

These fixtures demonstrate the Phase 1 browser capture workflow without real customer, provider, or production data.

Run from any repository where you want to create a demo `.tracepad` session:

```bash
tracepad view-browser /path/to/tracepad/examples/browser-capture/checkout-incident.capture.json
```

That is the quickest visual preview. For a fuller session with HAR evidence too:

```bash
tracepad init
tracepad start "Checkout latency demo"
tracepad import browser-capture --file /path/to/tracepad/examples/browser-capture/checkout-incident.capture.json --note "Demo browser session"
tracepad import browser-har --file /path/to/tracepad/examples/browser-capture/checkout-incident.har --note "Demo browser HAR"
tracepad export --format html --template postmortem --output ./checkout-demo-postmortem.html
open ./checkout-demo-postmortem.html
```

For a share-safe report, use full export redaction:

```bash
tracepad view-browser /path/to/tracepad/examples/browser-capture/checkout-incident.capture.json --redaction full --output ./checkout-demo-safe.html
```

Normal redaction keeps useful debugging context and applies built-in secret scrubbing. Full redaction aggressively scrubs personal/sensitive text and hides screenshot/diff previews because pixels and patches can contain sensitive data.

The demo models a common investigation path:

- Grafana shows checkout latency.
- ArgoCD shows a recent checkout API sync.
- OpenShift shows a restarted pod.
- The app UI logs a browser console error.
- A browser network request returns HTTP 503.

In the browser extension, use **Page** or `Alt+Shift+D` when a screen contains useful logs or details. That captures readable visible page text, headings, and log/code/table regions. Tab names and URLs are only context; Page capture is what records the on-screen details you are reading.

The sample token-like query value is intentionally fake and should be redacted by Tracepad on import.

The browser capture JSON fixture is intentionally not meant to be read directly. `tracepad view-browser` turns it into a visual report with:

- an investigation brief
- browser evidence cards
- captured tabs and URLs
- visible page/log/detail snapshots when Page capture is used
- console and failed network signals
- filterable timeline events
- clickable screenshot previews with open and zoom controls
- stored evidence under `.tracepad/artifacts`
