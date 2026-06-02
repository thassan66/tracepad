# Store Review Notes

Tracepad Browser Capture is a local-first debugging aid. It records browser evidence only after the user explicitly starts capture from the popup, and it exports a local JSON file for import into Tracepad.

## Data Handling

- No account is required.
- No backend is used.
- No analytics SDK is included.
- No ads are included.
- No telemetry is uploaded.
- Capture state is stored in browser local extension storage.
- Export uses the browser downloads API and creates a local JSON file.

## Permission Justification

- `activeTab`: read the active tab title, URL, selected text, visible page text, and capture visible-tab screenshots after user action.
- `downloads`: export `tracepad-browser-capture.json`.
- `scripting`: inject the content script when a page was opened before the extension was installed or before the content script loaded.
- `storage`: keep explicit capture state locally until export or clear.
- `tabs`: read tab title and URL for timeline context.
- `webRequest`: record failed requests and HTTP 4xx/5xx responses while capture is active.
- `<all_urls>` host permission: allow debugging across browser-based tools such as Grafana, OpenShift, ArgoCD, Kubernetes dashboards, CI/CD pages, internal admin portals, and app UIs.

## Manual QA Checklist

- Load unpacked extension in Chrome.
- Select **Start** and verify the popup shows recording state.
- Open at least two tabs and verify tab count increases after actions.
- Select text on a page and use **Selection**.
- Open a page with visible logs/details and use **Page**. Confirm export includes readable page text, headings, and log/detail text.
- Use **Screenshot** and confirm export includes a screenshot data URL.
- Trigger a failed request or HTTP 4xx/5xx response and confirm it appears in export.
- Trigger `console.error("tracepad test")` and confirm it appears in export when page hook injection is allowed.
- Use **Add Note** and confirm the note appears in export.
- Use `Alt+Shift+T` to start or stop capture.
- Use `Alt+Shift+S` to capture selected text.
- Use `Alt+Shift+D` to capture visible page text and log/details content.
- Use `Alt+Shift+P` to capture a visible-tab screenshot.
- Use `Alt+Shift+N` to prompt for and save a manual note.
- Verify shortcut customization is available under `chrome://extensions/shortcuts`.
- Use **Export** and import the JSON with `tracepad import browser-capture --file <downloaded-json>`.
- Use **Clear capture** and verify state resets.

## Known Store Review Constraints

Some browser and internal pages do not allow content script injection. The extension still records user notes, screenshots, tab context, and network failures when browser APIs allow it.
