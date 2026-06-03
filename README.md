# Tracepad

Tracepad is a local-first debugging recorder for developers.

It turns messy investigations across terminals, browser tabs, dashboards, CI/CD pages, Kubernetes consoles, and app UIs into a readable timeline you can review, export, and share.

No hosted service. No account. No daemon. Everything stays in the repo under `.tracepad`.

## Why Developers Use It

Debugging usually leaves important context scattered across:

- terminal scrollback
- shell history
- copied stack traces
- browser console errors
- failed network requests
- Grafana, OpenShift, ArgoCD, Kubernetes, and CI/CD screens
- git diffs and half-finished notes

Tracepad captures that work while you debug and turns it into:

- a compact CLI summary
- a local terminal dashboard
- a visual HTML investigation report
- replayable command history
- exportable handoff, issue, PR, Slack, or postmortem drafts

## Best Fit

Tracepad is useful for:

- backend and frontend engineers preserving reproduction steps
- DevOps and platform engineers triaging incidents across dashboards
- open-source maintainers turning bug reports into structured evidence
- reviewers who need to understand how a fix was found
- teams that want local-first debugging records without sending data to a SaaS backend

## Quick Start

Install directly from GitHub:

```bash
npm install -g github:thassan66/tracepad
tracepad --help
tracepad quickstart
```

If `tracepad` is not found after install, check npm's global prefix and add its `bin` directory to your shell path:

```bash
npm config get prefix
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
tracepad --help
```

If your prefix is not `$HOME/.npm-global`, replace that path with `$(npm config get prefix)/bin`. On macOS with zsh, use `.zprofile` for login shells and `.zshrc` for interactive shell customizations.

Or run from this repo:

```bash
node ./bin/tracepad.js --help
node ./bin/tracepad.js quickstart
```

Validate the repo before sharing a build:

```bash
npm run verify
npm run package:validate
npm pack --dry-run
```

Release notes and the release checklist live in [CHANGELOG.md](CHANGELOG.md) and [docs/release-readiness.md](docs/release-readiness.md).

For real-world feedback before adding more features, use [docs/dogfood-notes.md](docs/dogfood-notes.md).

Initialize Tracepad in any repo:

```bash
tracepad init --shell
```

Check the local setup:

```bash
tracepad doctor
```

Start a session:

```bash
tracepad start "Checkout API latency"
```

Debug normally:

```bash
npm test
git diff
curl http://localhost:3000/health
```

Add important findings:

```bash
tracepad note "HTTP 503 reproduced from checkout status endpoint" --kind finding
tracepad note "Deployment and latency spike started at the same time" --kind hypothesis
```

Check the session:

```bash
tracepad status
```

Stop and export a visual report:

```bash
tracepad stop "Root cause was a stale payment-status dependency"
```

`stop` captures final git status and final working-tree diff when available, then writes the visual report. Use `--no-final-status` or `--no-final-diff` when you want to skip that final evidence.

Reopen the latest dashboard any time:

```bash
tracepad review
```

`start`, `status`, `list`, `stop`, and `view-browser` render compact terminal panels with session metrics, recent timeline entries, next actions, and report paths.

For the easiest flow, use the recorder shell:

```bash
tracepad record "Checkout API latency"
# run normal commands in the temporary recorder shell
npm test
git diff
curl http://localhost:3000/health
exit
```

When the recorder shell exits, Tracepad records command outcomes, captures final git status/diff, closes the session, writes the dashboard, and opens it. It does not edit your shell profile.

## Browser Capture

Tracepad can import browser debugging evidence without deep API integrations.

Phase 1 supports generic browser capture data:

- tab title and URL
- screenshots
- console errors
- failed network requests
- HTTP 4xx/5xx events
- visible page/log/detail snapshots via the extension Page action
- selected text
- manual notes
- dashboard and app context

That means it works with browser-based tools like Grafana, OpenShift, ArgoCD, Kubernetes dashboards, CI/CD pages, internal admin portals, and app UIs.

Preview a browser extension JSON export in one command:

```bash
tracepad view-browser ./browser-capture.json
```

That creates a Tracepad session, imports the browser evidence, generates an HTML report, and opens it.

The extension records console/network failures automatically while recording is on. Use **Page** or `Alt+Shift+D` when you want Tracepad to read the current screen itself, such as logs, tables, Kubernetes details, CI/CD output, or dashboard panel text.

A no-build browser extension MVP is available in [browser-extension](browser-extension/README.md). Demo fixtures are available in [examples/browser-capture](examples/browser-capture/README.md).

## Visual Reports

HTML reports are static files. They can be opened locally or attached to a handoff without running a Tracepad server.

The current report includes:

- review workbench with handoff readiness score
- priority evidence ranking
- AI handoff prompt you can copy into any provider
- copy-ready PR, Jira, Slack, AI, and reviewer checklist share cards
- investigation brief
- suggested insights generated from captured history
- metric cards
- browser evidence board
- captured tabs and URLs
- console and network signals
- stored evidence cards
- filterable and searchable timeline
- inline git diff viewer
- clickable image artifact previews with open and zoom controls

Suggested insights and the AI handoff prompt are local heuristics today. They compare browser signals, failed commands, captured evidence, findings, hypotheses, and decisions without sending data to an AI service. The prompt is generated for copy/paste use, so teams can choose their own AI provider or keep the workflow fully offline.

Export redaction has two modes:

- `--redaction normal`: default mode, keeps useful debug context while applying the built-in secret redaction already used by Tracepad.
- `--redaction full`: sharing mode, scrubs personal/sensitive text more aggressively and hides screenshot/diff previews because pixels and patches can contain sensitive data.

Generate one manually:

```bash
tracepad review
tracepad export --format html --template postmortem --output ./incident.html
tracepad export --redaction full --format html --template postmortem --output ./share-safe-incident.html
open ./incident.html
```

Generate copy-ready handoff text without opening the dashboard:

```bash
tracepad share --format pr
tracepad share jira
tracepad share slack
tracepad share ai --redaction full --output ./ai-safe-prompt.md
```

Reopen and clean generated local files:

```bash
tracepad open
tracepad open --latest-screenshot
tracepad clean --dry-run
tracepad clean --browser-captures --dry-run
tracepad clean --exports --yes
```

`clean` never removes session history by default. Deletion requires `--yes` and an explicit scope such as `--exports`, `--browser-captures`, or `--all-generated`.

## Terminal Dashboard

Open a local terminal dashboard:

```bash
tracepad tui
```

Hotkeys:

- `q`: quit
- `r`: refresh
- `e`: export HTML
- `d`: capture git diff
- `n`: add quick note
- `[ ]`: select timeline event
- `j k`: scroll preview

## Core Commands

Session flow:

```bash
tracepad init --shell
tracepad doctor
tracepad start "Auth refresh bug"
tracepad note "Fails only when cache is warm" --kind finding
tracepad status
tracepad stop "Root cause was duplicate refresh under warm cache"
tracepad review
```

One-command recorder flow:

```bash
tracepad record "Auth refresh bug"
# run commands normally, then exit the recorder shell
exit
```

Scripted recorder flow:

```bash
tracepad record "CI smoke check" --command "npm test"
```

Capture command outcomes:

```bash
tracepad cmd "npm test" --exit-code 1 --note "Checkout test still fails"
tracepad history --limit 20
tracepad replay --format markdown
```

Attach evidence:

```bash
tracepad attach ./logs/server.log --note "Failure log"
tracepad attach --clip --note "Copied stack trace"
tracepad parse ./server.log --context-lines 3 --note "Fatal excerpt"
```

Capture code state:

```bash
tracepad diff --note "Working tree before fix"
tracepad diff --staged --note "Ready-to-commit delta"
tracepad diff --commit HEAD --note "Committed fix snapshot"
```

Import browser or log evidence:

```bash
tracepad import plain-log --file ./server.log --note "Failure excerpt"
tracepad import browser-har --file ./debug.har --note "Failed browser requests"
tracepad import browser-capture --file ./browser-capture.json --note "Dashboard investigation"
tracepad view-browser ./browser-capture.json
```

Export:

```bash
tracepad export --template handoff --output ./handoff.md
tracepad export --template pr --output ./pr-brief.md
tracepad export --template issue --output ./issue.md
tracepad share --format pr
tracepad share slack
tracepad open
tracepad clean --exports --dry-run
tracepad export --format html --template postmortem --output ./incident.html
tracepad export --redaction full --format html --template postmortem --output ./share-safe-incident.html
tracepad review
tracepad export --format json --output ./session.json
tracepad export --exporter slack --output ./session-slack.json
```

## Command Reference

- `init [--hooks] [--shell [bash|zsh|powershell]] [--install-shell] [--no-gitignore]`
- `alias setup [--shell bash|zsh|powershell] [--install]`
- `start "title" [--context "..."]`
- `record "title" [--context "..."] [--history-limit 12] [--no-history] [--no-status-snapshot] [--command "cmd"] [--capture] [--no-open]`
- `doctor [--shell bash|zsh|powershell]`
- `use <session-id>`
- `branch-sync [--create-if-missing]`
- `list`
- `status [session-id]`
- `tui [session-id]`
- `note "text" [--kind note|finding|hypothesis|decision|blocker|context]`
- `cmd "command text" [--exit-code <n>] [--note "..."] [--source manual|passive-shell|history]`
- `history [--shell powershell|bash|zsh] [--file <history-path>] [--limit <n>]`
- `parse <log-file> [--context-lines 2] [--max-matches 200] [--note "..."]`
- `review [session-id] [--output <file>] [--redaction normal|full] [--no-open]`
- `share [session-id|all|pr|jira|slack|ai|checklist] [--format all|pr|jira|slack|ai|checklist] [--redaction normal|full] [--output <file>]`
- `open [--latest-report|--latest-session|--latest-screenshot] [--no-open]`
- `clean [--dry-run] [--exports] [--browser-captures] [--all-generated] [--yes]`
- `import <importer-name> [--file <path>] [--note "..."]`
- `view-browser <browser-capture.json> [--output <file>] [--redaction normal|full] [--no-open]`
- `replay [session-id] [--format shell|markdown] [--output <file>]`
- `diff [--staged] [--commit <ref>] [--note "..."]`
- `capture`
- `attach <file-path> [--note "..."] [--clip]`
- `export [session-id] [--format markdown|html|json] [--template handoff|issue|pr|postmortem|slack] [--redaction normal|full] [--exporter <name>] [--output <file>]`
- `stop [summary text] [--summary "..."] [--format html|markdown|json] [--redaction normal|full] [--output <file>] [--no-final-status] [--no-final-diff]`
- `close [summary text] [--summary "..."]`

## Plugin Surface

Built-in plugins live under:

- `src/plugins/importers`
- `src/plugins/exporters`

Repo-local/private plugins can live under:

- `.tracepad/plugins/importers`
- `.tracepad/plugins/exporters`

Current built-in plugins:

- `plain-log`: extracts high-signal error lines from text logs
- `browser-har`: extracts failed, slow, and high-signal browser network requests from HAR files
- `browser-capture`: imports tabs, console errors, network failures, selected text, notes, and screenshots
- `slack`: exports Slack Block Kit JSON

Plugin contracts are documented in [src/plugins/README.md](src/plugins/README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Git Hook Automation

`tracepad init --hooks` installs lightweight local git hooks:

- `post-commit` captures `git show HEAD` into the active session
- `post-checkout` switches the active session to the current branch, or creates one when needed

This keeps Tracepad close to the actual debugging loop without a background process.

## Data Model

Tracepad stores local session data in:

- `.tracepad/state.json`
- `.tracepad/sessions/<session-id>.json`
- `.tracepad/artifacts/<session-id>/...`
- `.tracepad/exports/...`

`schema/session.schema.json` describes the public session format.

Session JSON files are intentionally not ignored by default. Teams can choose whether investigation history belongs in their repo.

## Safety

Tracepad is local-first. It has no hosted backend, account system, analytics, telemetry, or cloud sync.

Tracepad applies lightweight redaction before saving or exporting text. It scrubs common secret patterns such as:

- AWS access keys
- bearer tokens
- JWT-like tokens
- private key blocks
- common `password=` or `token=` style assignments

This is a safety net, not a compliance boundary. Screenshots, diffs, logs, paths, and copied text may still contain sensitive data. Use `--redaction full` for external sharing and review exported reports before sharing them outside your trusted team.

## Roadmap Direction

The local-first core is meant to stay free and useful. Future product layers can build on top of it:

- richer browser extension capture
- team report sharing
- hosted searchable archives
- AI-assisted incident summaries
- integrations with issue trackers and chat tools

The baseline promise should stay the same: developers can capture and review debugging work without giving up local control.
