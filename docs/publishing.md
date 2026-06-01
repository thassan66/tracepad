# Publishing Tracepad

Tracepad is designed to publish as a lightweight npm CLI with no runtime dependencies.

## Preflight

Run the local validation suite:

```bash
npm run verify
npm run pack:dry
npm run extension:package
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

## GitHub Actions

The repository includes:

- `.github/workflows/ci.yml`: validates Tracepad, checks package contents, packages the browser extension, and uploads the extension zip for each PR and `master` push.
- `.github/workflows/release.yml`: builds release artifacts from a tag or manual workflow run.

For npm publishing through GitHub Actions, add an `NPM_TOKEN` repository secret and run the **Release** workflow manually with `publish_npm=true`.

For GitHub release artifacts, push a version tag:

```bash
git tag v0.5.1
git push origin v0.5.1
```

The release workflow attaches:

- npm package tarball
- browser extension zip
