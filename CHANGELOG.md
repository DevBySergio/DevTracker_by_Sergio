# Changelog

All notable changes to DevTracker by Sergio are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This repository did not tag its early releases, so the dates below are reconstructed from the corresponding version commits.

## [Unreleased]

### Added

- Versioned schema-v2 storage with strict legacy migration, corruption backups, queued writes, local-day rollups, configurable detail retention, and URI-safe project identity.
- A four-view Overview, Trends, Projects, and Workflow dashboard with bounded typed messages, live deltas, loading/error/empty states, and accessible chart tables.
- Descriptive activity, flow, switching, diagnostics, goals, distributions, comparisons, and personal-insight metrics governed by a public metric contract.
- Independently opt-in Git, Debug, and exact-name VS Code Tasks integrations with explicit privacy boundaries.
- Versioned lossless JSON exports, safe daily CSV summaries, data-folder access, and backup-before-reset controls.
- Light, dark, and high-contrast support, responsive layouts, keyboard navigation, reduced motion, automated accessibility checks, and visual regression coverage.
- Unit, migration, range-query, metric-contract, Extension Host, webview, and large-history performance suites.
- A complete local and CI validation gate with deterministic VSIX content checks and retained failure diagnostics.

### Changed

- Replaced legacy polling and global counters with interaction-driven tracking, monotonic durations, explicit inactivity/focus states, and overlap-safe aggregation.
- Replaced misleading keystroke, paste, line-churn, focus-score, quality-score, and productivity language with contracted descriptive terms and explicit limitations.
- Moved current data to VS Code extension storage. The legacy `~/.devtracker/data.json` file is read only during migration and is preserved as source evidence.
- Rewrote public documentation around actual capabilities, local storage, configurable privacy, optional integrations, and explicit exports.

## [1.4.1] - 2026-05-18

### Changed

- Refined the dashboard interface and responsive presentation introduced in 1.4.0.

## [1.4.0] - 2026-05-18

### Added

- Expanded the dashboard into Today, Project, Quality, and Global views.
- Added editor-event, flow, diagnostics, save-rhythm, debug, Git, language, file, and hourly activity displays.
- Added broader persistence, command, and dashboard test coverage.

### Changed

- Reworked local data saving and dashboard rendering for the expanded metric model.

## [1.3.1] - 2026-02-18

### Changed

- Added the current extension icon and updated Marketplace-facing package metadata.

## [1.3.0] - 2026-02-18

### Added

- Added dashboard screenshots and the MIT license.

### Changed

- Refreshed the dashboard layout and corrected early data and tracking behavior.

## [1.2.0] - 2026-02-13

### Added

- Added per-file activity history, a top-files table, and hourly activity visualization.
- Added third-party license notices.

## [1.1.1] - 2026-02-13

### Fixed

- Preserved the accumulated daily total across VS Code restarts for goal and status-bar progress.
- Corrected the global hourly activity aggregation and related dashboard updates.

## [1.1.0] - 2026-02-13

### Added

- Added persistent per-project history, daily-goal configuration, configurable project ranges, and project/global language views.
- Added a session-aware status bar and improved the existing CSV export flow.

## [1.0.0] - 2026-02-13

### Added

- Initial local editor-activity tracker with a session dashboard, project history, global totals, daily goals, CSV export, and local JSON storage.
