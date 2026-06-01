# Publishing Tracepad

Tracepad is designed to publish as a lightweight npm CLI with no runtime dependencies.

## Preflight

Run the local validation suite:

```bash
npm test
npm run pack:dry
```

Check the package contents:

```bash
npm pack --dry-run
```

The package should include:

- `bin/`
- `src/plugins/`
- `schema/`
- `docs/*.md`
- `README.md`
- `CONTRIBUTING.md`
- `LICENSE`

It should not include generated `.tracepad` sessions, exports, artifacts, or demo build workspaces.

## First Publish

Make sure you are logged in:

```bash
npm whoami
```

If needed:

```bash
npm login
```

Publish:

```bash
npm publish
```

After publish, verify a clean install:

```bash
npm install -g tracepad
tracepad --help
```

## Future Releases

Update the version with npm so `package.json` stays consistent:

```bash
npm version patch
npm publish
```

Use `minor` for meaningful new features and `major` for breaking CLI/session-format changes.
