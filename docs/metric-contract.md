# DevTracker v2 metric contract

Status: normative for DevTracker 2.x implementation work.

This document defines what DevTracker may measure, how each value is named, and
what conclusions the product may draw from it. It is the source of truth for the
storage, query, export, and presentation tasks in the v2 backlog.

DevTracker reports local editor activity. It does not measure productivity,
code quality, developer performance, effort, or business value. A larger value
is not inherently better or worse.

## Precision vocabulary

Every metric must use one of these precision classes in product documentation
and exports:

| Class | Meaning |
| --- | --- |
| Exact event count | The number of matching VS Code events observed while the extension was running. It is not a count of physical user gestures. |
| Monotonic duration | Elapsed time calculated with a monotonic clock, rounded to the nearest output unit. Calendar time changes cannot alter it. |
| Current snapshot | The latest observed state at a specific instant. Snapshots must not be summed across time. |
| Derived | A deterministic calculation from contracted metrics. The formula and zero-data behavior must be documented. |
| Editor approximation | A value derived from editor change payloads that must not be presented as a Git diff, final-document delta, or exact human action. |
| Legacy approximation | Imported v1 data whose original collection method cannot satisfy the v2 contract. |

Durations are stored as integer milliseconds in activity intervals. Queries and
exports may round them to integer seconds. Percentages are calculated from
unrounded values and displayed as whole percentages unless a view explicitly
needs one decimal place.

## Scope and dimensions

Each observation belongs to one extension-host instance and, when applicable,
one project and document. Rollups may use the following dimensions:

| Dimension | Contract |
| --- | --- |
| Instance | A random identifier for one extension-host lifetime. Never shown as a developer identity. |
| Project | A stable identifier derived from a canonical workspace URI. Projects with the same basename remain distinct. |
| Document | A stable, privacy-mode-aware identifier. Analytical rollups must not require an absolute path. |
| Language | The VS Code language identifier at observation time. |
| Local day | The user's local calendar date. Intervals that cross midnight are split at the boundary. |
| Hour bucket | A local 15-minute bucket for timelines. Daylight-saving offsets are retained so repeated hours remain distinct. |
| Session | One extension-host tracking session. Multiple sessions may overlap and must be deduplicated for global time. |

Project metrics include only observations attributed to that project. Global
metrics use the union of overlapping intervals across extension hosts; they do
not add two clocks that represent the same human time.

## Tracking states and time metrics

A meaningful interaction is a document edit, save, debounced selection change,
or confirmed active-document change in an included workspace. Merely receiving
a timer tick is not an interaction. Selection changes refresh activity at most
once per second; edits, saves, and active-document changes are not subject to
that debounce.

The current session and dashboard snapshot expose `trackingStatus` as one of
`active`, `inactive`, `paused`, or `unfocused`, plus `lastUpdatedAt` as a wall
clock timestamp for the latest accepted interaction or state transition. Timer
heartbeats do not update that freshness timestamp unless they cause the
transition to `inactive`.

| Name | Unit | Scope | Source | Precision and rules |
| --- | --- | --- | --- | --- |
| Active time (`activeTimeMs`) | Milliseconds | Session, project, day, range, global | Meaningful interactions plus the activity state machine | Monotonic duration. The state is active while the window is focused, tracking is not paused, and the last meaningful interaction is less than 5 minutes old. Intervals stop at pause, focus loss, exclusion, deactivation, or the inactivity deadline. |
| Inactive state | State, not a historical counter | Current session | Activity state machine | Begins 5 minutes after the last meaningful interaction while the window remains focused. DevTracker exposes the state and last update time but does not accumulate unlimited inactive hours. |
| Paused state | State | Current session | Explicit user control | No activity interval or detailed observation is recorded while paused. |
| Unfocused state | State | Current session | `onDidChangeWindowState` | Ends an active interval immediately. It is not inactivity and is not persisted as developer activity. |
| Debug elapsed time (`debugElapsedMs`) | Milliseconds | Debug session, project, range | VS Code debug session start and termination events | Monotonic duration per debug session. Overlapping debug sessions are unioned for total elapsed time. |
| Active time while debugging (`debugActiveTimeMs`) | Milliseconds | Project, range | Intersection of active intervals and debug-session intervals | Monotonic duration. This is distinct from debug elapsed time. |

The five-minute threshold is a collection rule, not evidence that every second
inside an active interval involved typing or thinking about code.

Active intervals close immediately on pause, focus loss, excluded editor
context, or extension disposal. Pause, focus loss, and disposal also request a
persistence flush. Resuming or regaining focus can return to `active` only while
the latest meaningful interaction remains inside the five-minute window;
otherwise the state is `inactive`.

Elapsed duration always comes from the monotonic clock. For local-day
attribution, each emitted monotonic slice is projected from its last wall-clock
anchor and divided at local midnight. A forward or backward wall-clock change
therefore changes calendar attribution only; it never inflates or subtracts
elapsed active time.

## Editor activity metrics

The following are descriptive editor observations. They never imply value,
quality, difficulty, or productivity.

| Name | Unit | Scope | Source | Precision and rules |
| --- | --- | --- | --- | --- |
| Edit events (`editEvents`) | Events | Document, project, day, range | `onDidChangeTextDocument` payloads | Exact event count. One user gesture may emit zero, one, or several events. |
| Inserted characters (`insertedCharacters`) | UTF-16 code units | Document, project, day, range | Sum of `contentChange.text.length` | Exact for observed payloads. It is not a keystroke count. |
| Removed characters (`removedCharacters`) | UTF-16 code units | Document, project, day, range | Sum of `contentChange.rangeLength` | Exact for observed payloads. Replacements contribute to both inserted and removed values. |
| Large edit events (`largeEditEvents`) | Events | Document, project, day, range | Observed edit events | Exact event count under a heuristic: at least 80 inserted UTF-16 code units or at least 4 inserted line breaks. It must not be called a paste count. |
| Inserted line breaks (`insertedLineBreaksApprox`) | Line breaks | Document, project, day, range | Newline characters in inserted text | Editor approximation. It is not Git lines added or new value. |
| Removed line breaks (`removedLineBreaksApprox`) | Line breaks | Document, project, day, range | Line span of the replaced range | Editor approximation. It is not Git lines deleted or refactoring. |
| Save events (`saveEvents`) | Events | Document, project, day, range | `onDidSaveTextDocument` | Exact event count while DevTracker is running. Auto-save and explicit save are not distinguished. |
| Active file time (`activeFileTimeMs`) | Milliseconds | Document, project, day, range | Active intervals attributed to the active document | Monotonic duration. Values across documents may be summed only after interval deduplication. |
| Unique active files (`uniqueActiveFiles`) | Files | Project, range | Distinct privacy-safe document IDs with positive active file time | Derived exact distinct count from retained detail. It is unavailable when file-path mode is `none`. |

The v2 names above replace the misleading v1 names `keystrokes`,
`pasteEvents`, `filesTouched`, `linesAdded`, `linesDeleted`, and “line churn.”
The old fields may appear only in the legacy import adapter and the legacy
mapping section below.

The transitional compatibility snapshot may retain those v1 fields so older
history remains readable, but live collection does not increment them. New
events and CSV exports use only the canonical v2 names above. Unique active
files are derived from the keys of `activeTimeByDocumentMs`; edit events never
add entries or time to that map.

## Flow and switching metrics

| Name | Unit | Scope | Source | Precision and rules |
| --- | --- | --- | --- | --- |
| Flow blocks (`flowBlockCount`) | Blocks | Project, day, range | Meaningful interaction timestamps and active intervals | Derived. A block starts only with an accepted meaningful interaction. It remains open while consecutive accepted interactions are less than 120 seconds apart. Rejected or selection-debounced events do not start or extend it. |
| Current flow duration (`currentFlowActiveMs`) | Milliseconds | Current project/session | Active intervals in the open block | Derived monotonic duration. It is zero exactly at the 120-second inactivity deadline, even though active-time eligibility continues until 300 seconds. |
| Total flow duration (`flowActiveMs`) | Milliseconds | Project, day, range | Active intervals assigned to flow blocks | Derived monotonic duration. It never includes inactive, paused, or unfocused time. |
| Longest flow duration (`longestFlowActiveMs`) | Milliseconds | Project, day, range | Completed and current flow blocks | Derived maximum of flow active durations. |
| File switches (`fileSwitchEvents`) | Confirmed switches | Project, day, range | Active-document changes | Exact confirmed event count. A candidate document must remain active for 5 seconds; returning before then records no switch. |
| Project switches (`projectSwitchEvents`) | Confirmed switches | Day, range, global | Confirmed active-document changes across project IDs | Exact confirmed event count with the same 5-second debounce. It is reported separately from file switches. |
| File switches per active hour | Switches/hour | Project, range | `fileSwitchEvents / (activeTimeMs / 3,600,000)` | Derived. Return `null` when active time is zero; do not display infinity or zero as if it were observed. |

“Flow” describes a continuity pattern in observed editor activity. It is not a
psychological flow-state diagnosis.

Local midnight and pause, focus-loss, or excluded-context transitions close the
current flow block. Resume or focus regain does not create a block by itself;
the next accepted meaningful interaction does. Flow active duration accrued up
to local midnight is assigned to the ending day, and a post-midnight
interaction starts a new block on the new day.

An active-document change first creates a candidate. Confirmation occurs at
exactly five seconds of uninterrupted residency. Replacing the candidate or
returning to the confirmed document before that deadline records nothing.
Pause, focus loss, and context exclusion cancel an unconfirmed candidate. A
confirmed cross-project document change increments both `fileSwitchEvents` and
`projectSwitchEvents`; a same-project change increments only
`fileSwitchEvents`. `contextSwitches` remains a legacy compatibility field and
must not be interpreted as the precise v2 counter.

## Diagnostics, Git, debug, and task metrics

Git, debug detail, and VS Code Tasks tracking are disabled by default. Enabling
one integration does not imply consent for another.

| Name | Unit | Scope | Source | Precision and rules |
| --- | --- | --- | --- | --- |
| Current diagnostics by severity | Diagnostics | Project snapshot | `languages.getDiagnostics()` | Current snapshot. Counts errors, warnings, information, and hints; messages and source text are never stored. |
| Introduced diagnostics by severity | Diagnostics | Project, bucket, range | Difference between consecutive normalized snapshots | Derived event count. Only positive deltas are introduced. |
| Resolved diagnostics by severity | Diagnostics | Project, bucket, range | Difference between consecutive normalized snapshots | Derived event count. Only negative deltas are resolved. |
| Peak diagnostics by severity | Diagnostics | Project, range | Maximum snapshot per severity | Derived maximum. Snapshots are never summed. |
| Current dirty files | Unique files | Repository snapshot | VS Code Git repository state | Current snapshot. A path present in multiple status groups is counted once. |
| Branch active time | Milliseconds | Repository branch, range | Intersection of active intervals with repository HEAD state | Monotonic duration. Detached HEAD and unavailable states are explicit values. |
| Branch changes | Events | Repository, range | Git repository state changes | Exact observed event count. |
| Detected commits | Events | Repository, range | Local HEAD transitions | Exact observed transition count, not authored-commit productivity. |
| Task runs | Runs | Configured task, range | VS Code Tasks start/end events | Exact observed runs. Store only configured name, classification, duration, and result. |
| Task success rate | Percent | Configured task/class/range | Successful runs divided by completed runs | Derived. `null` when no run completed. Cancellation and unknown exit status are separate outcomes. |
| Median task duration | Milliseconds | Configured task/class/range | Completed run durations | Derived median; `null` when no run completed. |

Diagnostics are editor signals, not code-quality measurements. Dirty files,
branch activity, debug time, saves, and task outcomes are context, not ratings.

## Goals, distributions, and personal insights

| Name | Unit | Scope | Formula and precision |
| --- | --- | --- | --- |
| Daily or weekly goal | Milliseconds | User setting | Exact configured duration. A goal is optional and is not a performance target imposed by DevTracker. |
| Goal completion | Percent | Day or calendar week | `min(100, activeTimeMs / goalMs * 100)`. `null` when the goal is absent or invalid. Values above the goal may be retained separately but the progress display caps at 100%. |
| Active days | Days | Range | Count of local days with positive active time. |
| Streak | Consecutive local days | Through a selected day | Consecutive days with positive active time. Future days never participate. |
| Project/language/file distribution | Percent | Range | Deduplicated active time for the dimension divided by total active time. `null` with no active time. |
| Top-3 file share | Percent | Project or global range | Active time in the three most active retained documents divided by total active time. This is a concentration description, not a focus score. Unavailable when file detail is disabled. |
| Most active hour | Local hour bucket | Range | Bucket with the greatest active time. Ties choose the earliest bucket. It is not a “best” hour. |
| Save rate | Events/active hour | Project, range | `saveEvents / (activeTimeMs / 3,600,000)`. `null` with no active time. |
| Character edit rate | UTF-16 code units/active hour | Project, range | `(insertedCharacters + removedCharacters) / active hours`. `null` with no active time. |
| Four-week baseline | Milliseconds or contracted rate | User, metric | Median of the four previous complete calendar weeks with data. Fewer than two complete weeks yields `null`. |
| Period change | Percent | Two equivalent complete periods | `(current - previous) / previous * 100`. `null` when the previous value is zero; the UI may show the absolute difference instead. |

A “Focus Profile” may present top-3 file share, file switches per active hour,
and typical flow duration side by side. It must not collapse them into an opaque
score or label the result good, bad, productive, or unproductive.

## Legacy v1 import mapping

Imported values retain a `legacyApproximate: true` marker at the smallest
available record scope. Missing v1 values become unavailable, not invented zero
measurements.

| v1 field or label | v2 import name | Treatment |
| --- | --- | --- |
| `seconds`, `focusSeconds` | `legacyActiveTimeMs` | Legacy approximation. One-second polling could attribute up to five minutes after the last interaction and overlapping windows were not deduplicated. Do not add both source fields. |
| `keystrokes` | `legacyCharacterEditVolume` | Legacy approximation. It stored the larger of inserted or replaced code units per change, with a minimum of one; it cannot be split into inserted and removed characters. |
| `pasteEvents` | `legacyLargeEditEvents` | Legacy approximation under the old size heuristic. Never label it as paste. |
| `filesTouched` | `legacyFileActivitySamples` | Legacy approximation mixing one-second timer samples with edit events. It cannot produce unique-file or interaction counts. |
| `linesAdded`, `linesDeleted`, “line churn” | `legacyInsertedLineBreaksApprox`, `legacyRemovedLineBreaksApprox` | Legacy editor approximation. Never present as Git churn, value created, or refactoring. |
| `editEvents` | `legacyEditEvents` | Exact observed callback count, subject to extension uptime. |
| `saves` | `legacySaveEvents` | Exact observed save-event count, subject to extension uptime. |
| `idleSeconds` | `legacyUnfocusedTimeMs` | Legacy approximation. It counted unfocused timer ticks, not the defined inactive state, and must not feed active-time ratios. |
| `contextSwitches` | `legacyImmediateFileTransitions` | Legacy approximation without the five-second confirmation and without separate project switches. |
| `flow.*` | `legacyFlow*` | Legacy approximation driven by timer ticks; current flow may remain non-zero after expiry. |
| `diagnosticsBySeverity` | Latest legacy snapshot per day | Current-snapshot semantics only. Daily snapshots must not be summed to create a range total. |
| `gitDirtyFiles` | `legacyGitStatusEntries` | Legacy approximation; the same path could occur in more than one Git status group. |
| `branches` | `legacyBranchSampleTimeMs` | Legacy approximation because one global repository state could be attributed to another project. |
| `debugSeconds` | `legacyDebugSampleTimeMs` | Legacy approximation because concurrent sessions were represented by one global boolean. |
| `languages`, `files`, `hours` | Legacy active-time distributions | Legacy approximation using the v1 polling clock. Preserve for history but keep the approximation marker. |

## Numerical examples

1. An edit replaces 2 UTF-16 code units with `abc`. It records one edit event,
   3 inserted characters, and 2 removed characters. It is not a large edit.
2. One extension host is active from 09:00 to 09:10 and another from 09:05 to
   09:12. Their global active time is the interval union, 12 minutes, not the
   17-minute sum. Project rollups use deterministic most-recent-interaction
   attribution for the overlap.
3. File A is active, file B becomes a candidate at 10:01:00, and remains active
   through 10:01:05. Exactly one file switch is confirmed at 10:01:05. Returning
   to A at 10:01:03 would record no switch.
4. Meaningful interactions at 10:00, 10:01, and 10:04 create two flow blocks:
   the first two interactions are 60 seconds apart; the third is 180 seconds
   later, exceeding the 120-second gap.
5. A range has 7,200 active seconds and a 14,400-second daily goal. Goal
   completion is 50%. If the three most active files account for 6,300 seconds,
   top-3 file share is 87.5%, displayed as 88%. Neither value is a performance
   or focus rating.
6. Diagnostics snapshots change from 3 errors and 2 warnings to 1 error and 4
   warnings. The latest snapshot is 1 and 4, the count deltas are 2 resolved
   errors and 2 introduced warnings, and the peaks are 3 errors and 4 warnings.
   The snapshots must not be summed into 4 errors and 6 warnings.

## Acceptance criteria

1. Storage, query view models, JSON export, CSV headings, and user-visible copy
   use the v2 names in this contract. Old names are isolated to migration code.
2. Tests use fake wall and monotonic clocks to cover five-minute inactivity,
   the 120-second flow gap, midnight, daylight-saving changes, pause, focus loss,
   and deactivation.
3. Two- and three-window tests prove that overlapping active intervals are
   unioned and project attribution is deterministic.
4. Edit tests cover insertion, deletion, replacement, multi-change events,
   multi-line edits, and the large-edit threshold.
5. Switching tests cover the five-second confirmation, rapid A-B-A changes,
   project changes, and zero-active-time rate behavior.
6. Diagnostics tests prove that current snapshots are replaced, introduced and
   resolved deltas are bucketed, peaks use `max`, and snapshots are never summed.
7. Every rate and percentage has explicit zero-data behavior; unavailable data
   is distinct from observed zero.
8. Legacy migration tests cover every row in the mapping table, preserve the v1
   source, and attach the approximation marker without manufacturing precision.
9. Product copy contains no productivity score, quality score, focus score,
   keystroke count, paste count, or Git line-churn claim.
10. Git, debug detail, and Tasks data remain disabled until separately enabled,
    and no diagnostic message, source content, terminal content, command, or
    launch configuration is persisted.
