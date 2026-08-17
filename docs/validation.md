# Validation and continuous integration

DevTracker exposes one release-quality local gate:

```sh
npm run validate
```

Install the Playwright Chromium runtime once before the first local run:

```sh
npm run test:webview:install
```

The gate stops on the first failure and performs these checks in order:

1. Strict, no-emit type checking for the extension and dashboard webview.
2. ESLint with zero permitted warnings.
3. The complete unit and performance suite.
4. Browser interaction, accessibility, state, and screenshot regressions.
5. Isolated VS Code Extension Host integration tests.
6. Production extension and webview bundling.
7. VSIX creation plus a strict packaged-file allowlist, required-file check,
   path-safety check, and size budget.
8. A production-dependency security audit.

The validated package is written to `artifacts/DevTrackerBySergio-<version>.vsix`.
The `artifacts/` directory is generated and ignored by Git.

## GitHub Actions

`.github/workflows/validate.yml` runs the same gate for every pull request and
every push to `master` on Node.js 22. The workflow installs Chromium and its
Linux dependencies, runs Extension Host tests under Xvfb, and retains two kinds
of artifacts for 14 days:

- Playwright traces, screenshots, and image diffs from failed browser tests.
- The VSIX after the entire validation gate succeeds.

Screenshot baselines under `tests/webview/webview.spec.js-snapshots/` are source
artifacts and remain committed. Runtime reports under `test-results/` are not.
