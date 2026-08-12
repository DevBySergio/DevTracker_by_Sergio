# DevTracker v2 architecture boundaries

This document is normative for module dependencies. The metric semantics are
defined separately in the [metric contract](metric-contract.md).

## Composition

`src/extension.ts` is the composition root. It may instantiate concrete
adapters and connect them, but it must not own mutable tracking state, implement
business rules, perform persistence, query history, or render the dashboard.

The current composition is:

```text
VS Code activation
  -> TrackingController (extension-host event adapter)
     -> ActivityStateMachine (monotonic activity lifecycle)
     -> SessionActivityRecorder (validated intervals and active-time rollups)
     -> SessionDailyMetricsRecorder (edit, save, switch, and flow rollups)
     -> SessionGitMetricsRecorder (Git snapshots and transition rollups)
     -> TrackingStore (DataManager persistence boundary)
     -> DashboardQueryService (DevTrackerQueries)
     -> RangeAnalyticsQueryService (RangeQueryService -> RangeQueryEngine)
     -> PersonalInsightsService (calendar goals, baselines, distributions)
     -> GitAdapter (VscodeGitIntegration)
        -> GitRepositoryTracker (repository selection and transition semantics)
     -> DashboardPresentation (DashboardPresenter -> ReportPanel)
        -> DashboardProtocolController (bounded snapshots and live deltas)
     -> ExportService (versioned JSON and safe daily CSV)
     -> Clock, FileSystemAdapter, IntervalScheduler
```

All stateful components are instance-scoped and disposable. VS Code owns their
lifetime through `ExtensionContext.subscriptions`.

## Module responsibilities

| Module | Responsibility | Allowed dependencies |
| --- | --- | --- |
| `domain/` | Data types and domain rules with no I/O | Other domain modules only |
| `application/ports.ts` | Interfaces between the extension host and services | `domain/` only |
| `platform/ports.ts` | Clock, filesystem, and scheduler interfaces plus default Node adapters | Node standard library; no domain or VS Code dependency |
| `DataManager.ts` and `persistence/` | v1 compatibility plus schema-v2 storage and validation boundaries | `domain/`, `platform/`; no VS Code or presentation dependency |
| `queries/` | Indexed, typed dashboard and range read models assembled from tracking data | `application/ports`, `domain/`; no VS Code, filesystem, or presentation dependency |
| `integrations/` | Adapters for optional external VS Code capabilities such as Git | VS Code API and `application/ports`; no persistence or presentation dependency |
| `presentation/`, `webview/`, and `ReportPanel.ts` | Status bar, bounded dashboard protocol, host-side HTML template, and browser UI bundle | VS Code API, presentation ports, query view models, and `domain/`; no persistence writes |
| `tracking/` | Convert VS Code commands/events into typed service calls and own the monotonic activity state machine | VS Code API and application/platform ports; no concrete persistence, query, integration, or presenter class imports |
| `extension.ts` | Instantiate concrete implementations and register the root disposable | Any concrete module needed for composition; no behavior or mutable module state |

Dependencies point inward through interfaces. A service must not import a
concrete sibling service to reach another layer. Cross-layer communication is
added to an application port first and wired in the composition root.

## Ownership rules

- `ActivityStateMachine` owns the `active`, `inactive`, `paused`, and
  `unfocused` transitions, the five-minute inactivity deadline, selection
  debounce, 120-second flow deadline, five-second editor-context confirmation,
  and local-day splitting. It derives elapsed durations only from the monotonic
  clock.
- The tracking controller owns event subscriptions, timers, active-editor
  attribution, and the last observed workspace context. It feeds
  meaningful interactions and focus/pause lifecycle events to the state
  machine, then attributes emitted slices to the context that was active before
  the transition. A destination editor becomes the confirmed context only after
  it remains active for five seconds; transient candidates never reach the
  store.
- `DebugSessionTracker` owns the ephemeral set of VS Code debug-session IDs,
  active-session workspace attribution, monotonic union duration, privacy and
  pause boundaries, and the intersection with emitted human-active slices. It
  emits aggregate durations only; launch configuration and arguments never
  enter persistence.
- The store owns persisted data, pending mutations, atomic file replacement,
  write-queue health, and legacy compatibility. Mutations update memory first;
  record writes are debounced, serialized, and flushed at lifecycle boundaries.
  The legacy `contextSwitches` and `flow` shapes remain readable, while current
  tracking writes the explicit `fileSwitchEvents`, `projectSwitchEvents`,
  `flowBlockCount`, `flowActiveMs`, `longestFlowActiveMs`, and
  `currentFlowActiveMs` fields.
- Activity interval boundaries are rounded to integer milliseconds at the
  schema-v2 adapter boundary. Every accepted interval updates both retained
  session detail and the active-time language, document, and quarter-hour
  rollup dimensions, including the opt-in Git branch when available; editor,
  save, switch, flow, and Git events update the same rollup path before
  dashboard cache invalidation.
- `VscodeGitIntegration` owns built-in Git API activation and repository event
  subscriptions. `GitRepositoryTracker` keeps snapshots keyed by repository
  URI, selects the most-specific root containing an active document, counts
  unique dirty resources, and emits branch/commit transitions. Repository
  roots, resource URIs, and commit identifiers remain ephemeral; persistence
  receives only status, counts, and the opted-in branch dimension.
- Query services receive the narrower `TrackingReader` port and cannot call
  persistence mutations.
- Range queries receive `DailyRollupRangeReader`, load only explicit
  project/date keys, and aggregate through an in-memory date index. Rollup
  revisions invalidate cached typed view models without sending storage types
  to presentation code.
- Personal insights compose a selected range, the applicable calendar week,
  and the previous four complete weeks. Every result carries formula,
  precision, and unavailable-condition metadata; no aggregate productivity
  score is produced.
- The dashboard webview sends exact view/range/project requests. The host sends
  a bounded initial snapshot followed by structural deltas at most once per
  second, suspends queries while hidden, and never embeds complete history in
  the HTML document.
- The application shell owns the selected dashboard view, project, and range.
  It restores and persists those values with the VS Code webview
  `getState`/`setState` API, so editor changes cannot silently replace a user's
  dashboard context. Overview, Trends, Projects, and Workflow remain available
  from the persistent shell even when no text editor is active.
- Overview adapts the bounded `today` projection into a zero-filled 96-bucket
  wall-clock timeline and exactly three primary metrics: active time with daily
  goal progress, unique retained files, and observed flow blocks. Its Focus
  Profile and project/language shares reuse `buildPersonalInsights`, preserving
  the documented formulas and unavailability rules; file-level values remain
  unavailable when document identity storage is disabled.
- `ReportPanel` creates only a nonce, local resource URIs, and serialized startup
  configuration. `src/webview/template.ts` owns HTML, `webview/main.ts` is the
  separately type-checked browser entry, and `webview/styles.css` owns the
  reusable VS Code-native design tokens. Webpack emits the browser assets into
  `media/`; executable JavaScript and CSS are never assembled in template
  strings.
- `ReportPanel` keeps one panel instance until the user closes it, forwards live
  tracking status independently from range data, and maps the shell's Export,
  Settings, Open Data, and Reset actions through a fixed command allowlist.
  Arbitrary command names from the webview are never executed.
- Export commands use the same typed range service. JSON is versioned and
  deterministic; CSV is deliberately a daily summary with explicit units, a
  UTF-8 BOM, RFC-style quoting, and spreadsheet-formula neutralization.
- Integrations return typed snapshots or events. They do not write the store.
- Presentation receives a `DashboardSnapshot`. It does not fetch history or
  inspect editor state. The snapshot exposes `trackingStatus` and
  `lastUpdatedAt` both directly and through its session contract.
- Clock, filesystem, scheduler, Git, queries, store, and presentation are
  constructor-injected so tests can replace them without patching globals.

## Transitional boundaries

`DataManager.ts` and `ReportPanel.ts` retain their root paths so the 1.x API and
tests remain compatible during the v2 migration. `ReportPanel` consumes the
typed range protocol and delegates markup and browser behavior to the modular
webview boundary. Schema v2 can replace the store behind `TrackingStore`, and
the modular webview can evolve behind `DashboardPresentation`, without
changing the tracking controller.

The schema-v2 [storage layout](storage-v2.md) is initialized asynchronously
from `ExtensionContext.globalStorageUri`. Strict startup migration imports v1
history into approximate rollups while preserving the original file, and the
legacy dashboard writes only to a separate global-storage compatibility
snapshot. A private completion marker makes that import one-time so later
activations cannot replace newer v2 metrics. Schema v2 is the live tracking and
query path; the compatibility snapshot does not feed dashboard range queries.

The Git integration is event-driven and opt-in. It remains behind `GitAdapter`,
so VS Code Git API types do not leak into tracking, queries, persistence, or
presentation.

`WorkspaceIdentityRegistrar` adapts initial and newly added VS Code workspace
folders to the URI identity service and the `ProjectIdentityRegistry` port; the
composition root does not contain identity-registration behavior.

## Verification expectations

- Type checking must prove concrete services satisfy their ports.
- Persistence tests inject a clock and may inject a filesystem adapter.
- Query tests operate through `DashboardQueryService` and do not instantiate UI.
- Tracking tests use fake ports, clocks, and schedulers; they must not depend on
  module-level mutable state.
- Activity-state tests advance wall and monotonic time independently and cover
  inactivity, pause, focus, and local-midnight transitions.
- Extension Host tests verify only the VS Code adapter wiring and lifecycle.
