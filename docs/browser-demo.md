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
tracepad export --template postmortem --output ./checkout-demo-postmortem.md
```

Open `checkout-demo-postmortem.md`.

## Demo Talking Points

- Tracepad records the investigation timeline rather than only final notes.
- Browser evidence is generic and works across dashboards and internal tools.
- HAR and extension exports both land in the same Tracepad session.
- Secret-looking browser URL query values are redacted during import.
- The final postmortem can be shared without requiring a Tracepad server.
