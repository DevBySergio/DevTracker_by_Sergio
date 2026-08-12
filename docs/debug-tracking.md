# Debug-session tracking

Debug tracking is a local, opt-in integration controlled by
`devtracker.debugTrackingEnabled`. Enabling Git or Tasks tracking does not
enable debug tracking, and disabling the setting stops new measurements
immediately without reconstructing the time that elapsed while it was off.

DevTracker retains only two aggregate durations in schema-v2 daily rollups:

- `debugElapsedMs`: monotonic elapsed time while at least one debug session is
  active;
- `debugActiveTimeMs`: the intersection between contracted human active time
  and a period with an active debug session.

These metrics are deliberately separate. A debug session may continue while
the developer is inactive, and human activity may be attributed to the current
editor project even when the active debug session belongs to another workspace.

## Concurrency and attribution

The extension host keeps an ephemeral set of active VS Code debug-session IDs.
Nested sessions and multiple concurrent sessions do not multiply elapsed time.
Each monotonic slice is counted once and attributed to the active debug
session's workspace. If VS Code has no active session selection, the most
recent associated session is used. An unassociated session falls back to the
confirmed editor workspace at session start when available.

Switching the active debug session closes the current slice before changing
attribution. Starting or terminating one nested session therefore cannot stop
or duplicate the remaining sessions. Explicit DevTracker pause stops both
debug durations until resume; losing window focus does not stop the elapsed
debug session itself.

## Privacy boundary

The tracker accepts only a VS Code session identifier and an optional internal
project identity. Session identifiers remain in memory and are discarded when
the session terminates or the extension deactivates. Persisted daily rollups do
not contain session IDs, debug types, launch names, launch configuration,
arguments, adapter messages, terminal output, source paths, or source content.

Workspace association uses `DebugSession.workspaceFolder` when available and
otherwise the current eligible editor context. Excluded projects are not
associated. Remote and virtual workspace identities use the same URI-safe
identity service as the rest of schema v2.

## Verification

`src/test/debugSessionTracker.test.ts` covers concurrent and nested sessions,
active-session attribution, the active/debug intersection, privacy and pause
boundaries, and local-midnight splitting. The persistence test verifies that
only aggregate durations enter a daily rollup.
