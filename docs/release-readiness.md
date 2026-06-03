# Release Readiness

Use this checklist before tagging or publishing Tracepad.

## Preflight

```bash
git status --short --branch
npm run verify
npm run extension:package
npm pack --dry-run
```

The working tree should be clean except intentional release edits.

## Dogfood Tracepad

Run Tracepad against this repo before publishing:

```bash
tracepad init
tracepad record "Tracepad release readiness" --command "npm run verify"
tracepad share --format pr
tracepad review
tracepad clean --dry-run
```

The generated report should show:

- the verification command
- final git status/diff evidence when available
- a review workbench
- a share pack
- no unexpected sensitive data

## Package Checks

```bash
npm run package:validate
npm pack --dry-run
```

The package should include:

- `bin/`
- `src/plugins/`
- `schema/`
- `docs/*.md`
- `README.md`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `LICENSE`

It should not include:

- `.tracepad/`
- generated browser capture JSON exports
- `dist/`
- local demo output

## Privacy And Safety

Tracepad is local-first and has no hosted backend. Still, release notes and docs should remind users:

- Redaction is best-effort, not a compliance guarantee.
- Screenshots may contain sensitive data.
- Full redaction hides screenshot and diff previews.
- Users should review exported reports before sharing outside a trusted team.

## Tag And Release

Update `package.json`, `TOOL_VERSION`, and `CHANGELOG.md`, then tag:

```bash
git tag v0.6.0
git push origin v0.6.0
```

The release workflow attaches the npm package tarball and browser extension zip.

