# Dashboard accessibility

DevTracker uses native HTML controls and VS Code theme tokens throughout the
dashboard. Every view remains usable without a mouse or a chart canvas.

## Keyboard navigation

- `Tab` and `Shift+Tab` move through the project selector, date controls,
  actions, forms, project rows, and disclosure controls.
- The view tabs use the ARIA tabs pattern. `Left Arrow` and `Right Arrow` move
  and activate the previous or next view, wrapping at each end. `Home` opens
  Overview and `End` opens Workflow.
- Project rows support `Enter` and `Space`. All keyboard-operated elements use
  the VS Code focus-border token for a visible focus indicator.
- The skip link moves directly to the dashboard content.

## Charts and announcements

Every canvas chart has a labelled data-table alternative with a caption. The
table is available from the disclosure immediately after the chart. In forced
colors mode, chart canvases are hidden and their table alternatives open
automatically.

Metric values are deliberately not live regions. The dashboard can receive a
bounded data update once per second, and announcing every changed number would
make assistive technology unusable. Loading and error state remain available
through the page subtitle and `aria-busy` state.

## Themes, zoom, and motion

- Colors come from VS Code semantic tokens with system-color fallbacks for
  light, dark, high-contrast, and high-contrast-light themes.
- Chart colors are rebuilt when the host theme changes.
- Layouts stack at narrow widths, tables scroll inside their own regions, and
  controls wrap to remain usable at 200 percent zoom.
- Reduced-motion preferences disable dashboard animation and smooth scrolling.
- Forced-colors mode preserves borders, selection, focus, and text labels
  without relying on color alone.
