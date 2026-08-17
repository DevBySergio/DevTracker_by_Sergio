# Webview regression testing

DevTracker tests the compiled dashboard in an isolated local browser harness.
The harness uses deterministic metrics, dates, integration settings, and theme
tokens. It does not activate VS Code, read editor state, or touch extension
storage.

## Run the suite

Install the Chromium runtime once after installing dependencies:

```sh
npm run test:webview:install
```

Run accessibility, interaction, state, and screenshot regression tests:

```sh
npm run test:webview
```

The command compiles the extension test modules and webview assets before
starting the harness. Reports and failed-image artifacts are written under
`test-results/` and are not committed.

## Coverage

The suite verifies:

- ARIA tab navigation with arrow keys, `Home`, `End`, and roving tabindex.
- Keyboard selection of project rows and pressed state on range filters.
- Axe-core audits for Overview, Trends, Projects, and Workflow.
- Captioned table alternatives connected to every canvas chart.
- Populated, empty, loading, and error states.
- Light, dark, and high-contrast theme fixtures.
- Full-page layouts at 600, 900, and 1400 CSS pixels.
- Populated baselines for all four dashboard views.

## Updating screenshots

Screenshot changes must be intentional. Review the rendered result first, then
update the platform-specific baselines with:

```sh
npm run test:webview:update
```

Run `npm run test:webview` again without the update flag before accepting the
change. The regular command fails when more than 0.5 percent of pixels differ,
so significant layout, theme, and visibility changes cannot pass silently.
