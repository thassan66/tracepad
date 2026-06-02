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

The demo models a common investigation path:

- Grafana shows checkout latency.
- ArgoCD shows a recent checkout API sync.
- OpenShift shows a restarted pod.
- The app UI logs a browser console error.
- A browser network request returns HTTP 503.

The sample token-like query value is intentionally fake and should be redacted by Tracepad on import.

The browser capture JSON fixture is intentionally not meant to be read directly. Import it into a Tracepad session, then generate an HTML or Markdown report.
