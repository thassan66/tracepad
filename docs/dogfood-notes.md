# Dogfood Notes

Use this file to capture real Tracepad usage feedback before adding more features.

## How To Run A Dogfood Session

Run one real debugging workflow with Tracepad:

```bash
tracepad record "Dogfood: short problem title"
# debug normally
exit
tracepad review
tracepad share --format pr
```

For browser/dashboard work:

```bash
tracepad view-browser ./tracepad-browser-capture.json
tracepad review
```

## Session Template

Copy this block for each session.

```md
### Session: <short title>

- Date:
- Session type: terminal-only | browser/dashboard | PR/review handoff | incident/postmortem
- Repo/app:
- Goal:
- Commands used:
- Browser tools used:

#### What Worked

- 

#### Friction

- 

#### Report Quality

- Too noisy:
- Missing context:
- Useful sections:
- Useless sections:

#### Capture Quality

- Commands captured correctly:
- Browser/page content captured correctly:
- Screenshots useful:
- Duplicates/noise:

#### Redaction And Safety

- Secrets handled correctly:
- Redaction too aggressive:
- Redaction too weak:
- Screenshot/diff sensitivity:

#### Share Output

- PR output useful:
- Jira/issue output useful:
- Slack output useful:
- AI prompt useful:
- Reviewer checklist useful:

#### Priority

- Severity: low | medium | high
- Proposed change:
- Should this become a PR now? yes | no
```

## Decision Rule

Do not add a feature from an idea alone. Add it when at least one dogfood session shows concrete friction.

Prefer fixes in this order:

1. Install/setup confusion
2. Data safety or redaction issue
3. Incorrect or missing capture
4. Report noise that blocks handoff
5. Share output that is not useful in PR/Jira/Slack
6. Small polish

