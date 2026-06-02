# Browser Capture

Tracepad can import browser debugging evidence without needing direct integrations with Grafana, OpenShift, ArgoCD, Kubernetes dashboards, CI/CD pages, internal admin portals, or application UIs.

The Phase 1 workflow is file-based:

1. Start a Tracepad session.
2. Export browser evidence as a HAR file or Tracepad browser capture JSON.
3. Import the file into the active session.
4. Export a visual handoff, issue, PR brief, or postmortem.

```bash
tracepad start "Checkout latency spike"
tracepad import browser-har --file ./checkout-debug.har --note "Grafana and app API failures"
tracepad import browser-capture --file ./browser-capture.json --note "OpenShift and ArgoCD investigation"
tracepad export --format html --template postmortem --output ./debug-postmortem.html
open ./debug-postmortem.html
```

## HAR Import

Use `browser-har` for HAR files exported from browser devtools.

```bash
tracepad import browser-har --file ./debug.har
tracepad import browser-har --file ./debug.har --slow-ms 1500
tracepad import browser-har --file ./debug.har --all --max-events 200
```

The importer records:

- HTTP 4xx and 5xx responses
- network failures and request errors
- slow requests above the threshold
- a Markdown summary artifact under `.tracepad/artifacts`
- timeline findings for high-signal requests

## Browser Capture JSON

Use `browser-capture` for exports from a future browser extension, bookmarklet, or internal capture script.

A local no-build browser extension MVP is available in [`browser-extension/`](../browser-extension/README.md). Load it unpacked in Chrome or Edge, capture browser evidence, export JSON, then import it with:

```bash
tracepad view-browser ~/Downloads/tracepad-browser-capture.json
```

That command creates a Tracepad preview session, imports the JSON, generates an HTML report, and opens it. To write to a specific file without opening it:

```bash
tracepad view-browser ~/Downloads/tracepad-browser-capture.json --output ./browser-debug.html --no-open
```

For a share-safe report, use full export redaction:

```bash
tracepad view-browser ~/Downloads/tracepad-browser-capture.json --redaction full --output ./browser-debug-safe.html --no-open
```

For an existing Tracepad session, use the lower-level import/export flow:

```bash
tracepad import browser-capture --file ~/Downloads/tracepad-browser-capture.json
tracepad export --format html --template postmortem --output ./browser-debug.html
open ./browser-debug.html
```

The exported JSON is not the final viewing experience. Treat it as an evidence file that Tracepad imports into a session. The visual output is the generated HTML or Markdown report.

Default extension shortcuts:

- `Alt+Shift+T`: start or stop browser capture
- `Alt+Shift+S`: capture selected text
- `Alt+Shift+P`: capture visible-tab screenshot
- `Alt+Shift+N`: prompt for a manual note

Supported fields are intentionally generic:

```json
{
  "version": 1,
  "source": "tracepad-browser-extension",
  "capturedAt": "2026-06-02T09:30:00.000Z",
  "tabs": [
    {
      "title": "ArgoCD - checkout-api",
      "url": "https://argocd.example.local/applications/checkout-api",
      "capturedAt": "2026-06-02T09:31:00.000Z",
      "selectedText": "Sync failed: configmap checkout-api missing",
      "note": "Deployment was unhealthy after sync",
      "screenshot": {
        "fileName": "argocd-checkout-api.png",
        "dataUrl": "data:image/png;base64,..."
      }
    }
  ],
  "events": [
    {
      "type": "console",
      "level": "error",
      "title": "Checkout Admin",
      "url": "https://admin.example.local/checkout",
      "message": "Failed to load payment status",
      "at": "2026-06-02T09:32:00.000Z"
    },
    {
      "type": "network",
      "method": "GET",
      "url": "https://api.example.local/payments/status",
      "status": 503,
      "durationMs": 842,
      "message": "Service unavailable",
      "at": "2026-06-02T09:32:05.000Z"
    },
    {
      "type": "selection",
      "title": "OpenShift Console",
      "url": "https://openshift.example.local/k8s/ns/prod/pods",
      "selectedText": "checkout-api-7df9c CrashLoopBackOff",
      "at": "2026-06-02T09:33:00.000Z"
    },
    {
      "type": "note",
      "title": "Grafana",
      "url": "https://grafana.example.local/d/checkout",
      "message": "Latency spike started after latest deployment",
      "at": "2026-06-02T09:34:00.000Z"
    }
  ]
}
```

The importer records:

- browser tab title and URL
- console errors
- failed network requests
- selected text
- manual notes
- screenshots stored as session artifacts
- a Markdown summary artifact under `.tracepad/artifacts`

## Privacy

Tracepad redacts common secret patterns before saving imported text, including bearer tokens, JWT-like tokens, API keys, password assignments, and common token query parameters.

Exports support two redaction modes:

- `--redaction normal`: default mode for local debugging. Screenshots are clickable and can be opened and zoomed in the HTML report.
- `--redaction full`: sharing mode. Tracepad scrubs personal/sensitive text more aggressively and hides screenshot/diff previews because pixels and patches can contain private customer, environment, or infrastructure details.

Browser capture files should still be reviewed before sharing.
