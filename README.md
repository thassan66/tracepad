# Tracepad

Tracepad is a **debugging flight recorder** for engineers.

It captures the parts of an investigation that usually get lost:

- shell history
- commands you ran
- git status and diff snapshots
- findings and hypotheses
- evidence and artifacts
- the final handoff, PR brief, issue draft, or postmortem

The goal is simple: make debugging work replayable.

## Why it exists

Most debugging work disappears into shell history, loose notes, copied logs, and half-remembered context. That creates:

- weak handoffs
- slow PR reviews
- repeated investigations
- missing incident timelines
- unclear “what changed?” context

Tracepad keeps the session lightweight and close to the repo:

- no server
- no database
- no background agent
- no memory-heavy indexing

Everything lives under `.tracepad` in the target repo, so the session stays local and close to the code.

## 60-second workflow

Start the whole flow with one command:

```bash
node ./bin/tracepad.js record "Auth refresh bug" --context "User login fails after warm cache"
```

That will:

- create a session
- capture a baseline `git status` snapshot
- import recent shell history
- open compact capture mode

## Commands

Start a session manually:

```bash
node ./bin/tracepad.js start "NPE after token refresh"
```

Open the visual terminal dashboard:

```bash
node ./bin/tracepad.js tui
```

Add notes:

```bash
node ./bin/tracepad.js note "Fails only when cache is warm" --kind finding
node ./bin/tracepad.js note "Token refresh race in adapter" --kind hypothesis
node ./bin/tracepad.js note "Move refresh into single-flight guard" --kind decision
```

Record commands:

```bash
node ./bin/tracepad.js cmd "mvn test -Dtest=AuthFlowTest" --exit-code 1 --note "Refresh path still fails"
```

Import recent shell history:

```bash
node ./bin/tracepad.js history --limit 20
```

Capture a git diff snapshot:

```bash
node ./bin/tracepad.js diff --note "Working tree before auth refactor"
node ./bin/tracepad.js diff --staged --note "Ready-to-commit delta"
```

Use compact interactive capture mode:

```bash
node ./bin/tracepad.js capture
```

Export a polished brief:

```bash
node ./bin/tracepad.js export --format html --template handoff --output handoff.html
node ./bin/tracepad.js export --template pr --output pr-brief.md
node ./bin/tracepad.js export --template issue --output issue.md
node ./bin/tracepad.js export --template postmortem --output postmortem.md
```

Attach evidence:

```bash
node ./bin/tracepad.js attach ./logs/auth.log --note "Stack trace from local run"
```

Inspect status:

```bash
node ./bin/tracepad.js status
node ./bin/tracepad.js list
```

Close the session:

```bash
node ./bin/tracepad.js close --summary "Root cause was duplicate refresh under warm cache"
```

## Store layout

Tracepad writes:

- `.tracepad/state.json`
- `.tracepad/sessions/<session-id>.json`
- `.tracepad/artifacts/<session-id>/...`
- `.tracepad/exports/...`

Git diff and git status snapshots are stored in the same artifact area, so a session can preserve both evidence and code state.

## Why it feels better than raw notes

Tracepad is opinionated around the actual debugging loop:

- `record` gives you a fast start
- `capture` keeps event entry cheap
- `tui` gives you a screenshotable status board
- `export` turns the same session into different audience-ready outputs

That means one investigation can become:

- a maintainer handoff
- a PR debug brief
- a GitHub issue draft
- a postmortem draft

## Open-source value

Tracepad is useful for:

- open-source maintainers debugging community bug reports
- backend engineers handing off investigations
- DevOps engineers documenting incident triage
- Java and Node teams preserving repro and fix context

The free core is enough for daily use. Shared search, team timelines, and hosted incident archives can sit on top later without weakening the local-first OSS base.
