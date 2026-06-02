# Browser Debugging Demo

This demo shows Tracepad as a browser and terminal debugging flight recorder.

## Scenario

A checkout admin page is failing after a deployment. The investigation crosses Grafana, ArgoCD, OpenShift, and the app UI.

## Run the Demo

From a disposable repo:

```bash
tracepad init
tracepad start "Checkout latency demo" --context "Demo investigation across browser tools"
tracepad import browser-capture --file /path/to/tracepad/examples/browser-capture/checkout-incident.capture.json --note "Browser capture demo"
tracepad import browser-har --file /path/to/tracepad/examples/browser-capture/checkout-incident.har --note "HAR demo"
tracepad note "Likely regression after checkout-api:1.9.4 deployment" --kind hypothesis
tracepad export --format html --template postmortem --output ./checkout-demo-postmortem.html
```

Open `checkout-demo-postmortem.html`.

On macOS:

```bash
open ./checkout-demo-postmortem.html
```

## Demo Talking Points

- Tracepad records the investigation timeline rather than only final notes.
- Browser evidence is generic and works across dashboards and internal tools.
- HAR and extension exports both land in the same Tracepad session.
- Browser extension shortcuts make capture usable during active debugging.
- The visual report ranks priority evidence and shows handoff readiness.
- The AI handoff prompt can be copied into any provider without Tracepad sending data anywhere.
- Timeline search and signal filters make long sessions easier to review.
- Secret-looking browser URL query values are redacted during import.
- The final postmortem can be shared without requiring a Tracepad server.
