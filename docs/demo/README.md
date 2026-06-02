# Tracepad Hero GIF

The launch README should show Tracepad as a short terminal story:

1. Initialize Tracepad with passive shell capture.
2. Start a debugging session.
3. Run normal terminal commands.
4. Import browser/demo evidence.
5. Export a visual report and open the TUI.

## Generate

The reliable path is Docker, because the recorder needs VHS, Node, and Git in the same environment.

PowerShell:

```powershell
docker build -f docs/demo/Dockerfile.vhs -t tracepad-vhs .
docker run --rm -v "${PWD}:/work" -w /work tracepad-vhs docs/demo/hero.tape
```

Bash:

```bash
docker build -f docs/demo/Dockerfile.vhs -t tracepad-vhs .
docker run --rm -v "$PWD:/work" -w /work tracepad-vhs docs/demo/hero.tape
```

If you already have VHS, Node, and Git locally:

```bash
vhs docs/demo/hero.tape
```

Output:

```text
docs/demo/tracepad-hero.gif
```

The tape creates and resets `docs/demo/workspace`, so reruns are deterministic.

The recording shows:

- `tracepad init --hooks`
- `tracepad alias setup --shell bash`
- `tracepad start`
- a normal `npm test` command captured by passive shell integration
- `tracepad note --kind hypothesis`
- `tracepad parse`
- `tracepad import browser-capture`
- `tracepad diff`
- `tracepad replay`
- JSON, Slack, and HTML exports
- `tracepad status`
- `tracepad tui`
