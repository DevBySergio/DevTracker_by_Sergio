# Privacy, storage, and exports

DevTracker is local-first personal analytics software. It has no telemetry, account, hosted API, advertising SDK, or automatic upload. The extension collects editor activity only inside eligible workspace contexts, calculates its metrics locally, stores them in VS Code extension storage, and renders the dashboard in a local VS Code webview.

An explicit export creates a local file selected by the user. That file can contain sensitive names or activity patterns depending on the selected privacy settings and enabled integrations, so review it before sharing it.

## Default collection

The core tracker observes public VS Code editor events while the extension is running:

- accepted document edits and saves;
- debounced selection changes and confirmed active-document changes;
- VS Code window focus and explicit pause/resume state;
- project, language, local date, and privacy-safe document attribution;
- diagnostic counts by severity, without messages or source text.

Core collection does not inspect source contents, clipboard contents, keyboard keys, terminal sessions, commands, environment variables, network requests, or external application activity. An editor event count is not a physical gesture count, and active time is not continuous surveillance of user input.

The current document must belong to an included workspace. An excluded project, excluded document, untitled/outside-project document, paused tracker, or unfocused VS Code window contributes no activity.

## Optional integrations

Git, Debug, and VS Code Tasks are independent opt-ins. All three default to disabled, and enabling one does not enable another.

| Integration | Stored when enabled | Deliberately not stored |
| --- | --- | --- |
| Git | Integration state, local branch names, branch changes, deduplicated detected-commit events, branch-attributed active time, and unique dirty-file counts. | File contents, diffs, commit messages, author identity, remote URLs, credentials, or command output. |
| Debug | Debug-session elapsed time and the intersection of debugging with eligible active editor time. | Launch configurations, arguments, environment variables, console output, variables, stack frames, or evaluated expressions. |
| VS Code Tasks | Exact configured task name, `build` or `test` classification, monotonic duration, and success/failure/cancelled/unknown outcome. | Terminal content, command lines, task definitions, variables, process output, or arbitrary unconfigured tasks. |

Task tracking also requires an exact-name entry in `devtracker.trackedTasks`; the global task toggle alone records nothing.

## Storage layout

Current data is rooted at `ExtensionContext.globalStorageUri/v2`, which is private to the installed extension and VS Code profile. DevTracker exposes `DevTracker: Open Data Folder` so the exact location can be inspected without relying on an operating-system-specific path.

Schema v2 stores:

- a manifest and project registry;
- append-only session and activity records;
- per-project, per-local-day aggregate rollups;
- privacy-mode-aware document, language, branch, diagnostic, and configured-task dimensions;
- local backup and migration evidence when applicable.

Project identity is based on a canonical workspace URI so same-named folders, multi-root workspaces, remote workspaces, and virtual filesystems do not collapse into one record. Analytical exports reject absolute filesystem paths.

The legacy `~/.devtracker/data.json` file is an import source only. Migration preserves it, writes a backup, validates the converted schema-v2 data, and retains approximation markers for values whose old collection method cannot meet the current metric contract.

See [schema-v2 storage](storage-v2.md) for the file layout, write queue, migration, and query boundaries.

## Document identity modes

`devtracker.fileIdentityMode` controls retained document-level identity:

| Mode | Stored identity | Trade-off |
| --- | --- | --- |
| `relative` | Project-relative path. | Most useful file detail; names can reveal project structure. This is the default. |
| `hashed` | Profile-salted HMAC-SHA-256 identifier. | Preserves stable local grouping without storing the readable path. |
| `none` | No document identity. | Strongest minimization; file counts, file tables, and top-file concentration become unavailable. |

Changing the mode affects new observations. It does not rewrite previously retained history automatically.

## Exclusions

`devtracker.projectExclusionGlobs` matches normalized absolute project paths. A matching project contributes no aggregate or detailed activity.

`devtracker.documentExclusionGlobs` matches normalized project-relative document paths. A matching document contributes no aggregate or detailed activity.

Globs support `*`, `**`, and `?`. Invalid, empty, duplicate, or excessive entries are ignored by the settings sanitizer. Because exclusions apply at collection time, removing an exclusion does not reconstruct activity that was intentionally not recorded.

The Projects view also supports local archive and exclude preferences for navigation. These presentation preferences are stored in VS Code global state, do not modify historical rollups, and are not included in analytical exports.

## Retention and deletion

`devtracker.detailedDataRetentionDays` accepts an integer from 0 to 3650 and defaults to 30 days. Completed session detail ending at or before the cutoff is compacted. Aggregate daily rollups remain available so trends and long-range summaries do not disappear when detail expires.

Retention is not a secure-erasure guarantee for filesystem backups, operating-system snapshots, source legacy files, or exports that the user created separately.

`DevTracker: Back Up and Reset Data` requires confirmation, creates a timestamped local backup, resets active DevTracker data, and reloads VS Code. The backup remains local and is intentionally not removed by the reset.

## Exports

Exports are initiated only through a command. DevTracker never uploads an export.

### JSON

`DevTracker: Export Data (JSON)` writes either the selected range or complete retained history. The payload includes:

- an export-format version and data-schema version;
- the selected scope;
- metric names, units, and precision classes;
- normalized range data, project/day/dimension summaries, diagnostic rollups, configured-task outcomes, comparisons, and approximation markers.

Readable project-relative document names, local branch names, or configured task names may appear when the corresponding detail or integration is enabled. Absolute filesystem paths are rejected.

### Daily CSV

`DevTracker: Export Daily Summary (CSV)` writes one row per local day using canonical metric names and explicit units. It includes a UTF-8 BOM, CRLF rows, deterministic ordering, CSV quoting, and spreadsheet-formula neutralization. It intentionally omits raw sessions and detailed project, document, branch, and task-name dimensions.

The compatibility command ID `devtracker.exportCSV` produces the same safe daily summary.

## Metric interpretation

DevTracker reports observations and deterministic derivations. It does not measure productivity, code quality, developer performance, effort, or business value. Diagnostics, dirty files, commits, edits, saves, task outcomes, goal completion, and active time are context—not ratings.

The normative [metric contract](metric-contract.md) defines every metric, precision class, formula, zero-data behavior, legacy mapping, and interpretation boundary.
