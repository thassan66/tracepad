# Changelog

## 0.6.0 - 2026-06-03

Tracepad 0.6.0 is the first release-readiness milestone for the local-first debugging recorder.

### Added

- Browser capture import and preview for dashboard/app investigations.
- Browser extension capture workflow for tabs, screenshots, console errors, failed requests, selected text, notes, and page text snapshots.
- Visual HTML investigation dashboard with review workbench, priority evidence, AI handoff prompt, share pack, image zoom, diff preview, and searchable timeline.
- `tracepad record` temporary recorder shell for normal command capture without editing shell profiles.
- `tracepad doctor` setup diagnostics.
- `tracepad review` dashboard generation for the active or latest session.
- `tracepad share` copy-ready PR, Jira, Slack, AI, and reviewer checklist outputs.
- `tracepad open` and `tracepad clean` lifecycle commands for generated reports and browser capture files.
- `tracepad quickstart` first-run guidance.
- Package validation for npm metadata, CLI bin wiring, package contents, and dry-run packaging.

### Safety

- Added full export redaction mode for share-safe reports.
- Hide screenshot and diff previews in full redaction mode.
- Keep Tracepad local-first: no account, hosted service, backend, telemetry, or analytics.

### Validation

- `npm run verify` now runs smoke tests, browser extension validation, and npm package validation.

