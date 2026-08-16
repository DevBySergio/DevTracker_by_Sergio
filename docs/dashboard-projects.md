# Projects dashboard

The Projects view makes retained project history accessible independently from
the active VS Code editor. Selecting a row or changing the dashboard project
selector does not open a workspace, change the active editor, or change which
workspace receives newly tracked activity.

## Directory and range metrics

The directory includes every registered project, including projects with no
active time in the selected range. It supports search by original name, local
alias, or privacy-safe project ID, and sorting by active time, name, last
activity in the range, or range trend.

Projects with the same display name remain distinct. The dashboard shows a
short form of their stable privacy-safe project IDs so the rows and project
selector are unambiguous without exposing absolute workspace paths.

`Trend` compares equal older and newer halves of the selected range. For an odd
number of days, the middle day is omitted so both halves have the same length.
The value is unavailable when the range has fewer than two days or neither half
contains active time. `Last activity` is the latest day with positive active
time inside the selected range; it is not an all-time timestamp.

## Project details

Selecting a project displays its active time, character edit volume, five most
active languages, and eight most active retained file identities for the
selected range. File details follow `devtracker.fileIdentityMode` and are shown
as unavailable when document detail collection is disabled.

The Projects protocol deliberately bounds per-project distributions before
they cross the extension-to-webview boundary. This keeps the complete project
directory available while preserving the dashboard's payload limits.

## Local project preferences

An optional alias, archived state, and directory-exclusion state are stored in
VS Code's local extension global state. They are not added to analytical
rollups or exports and are never sent to a remote service.

- An alias changes only the dashboard display name.
- Archiving hides a project from the default directory.
- Excluding hides a project from the default directory in the same
  non-destructive way, for users who want a stronger organizational signal.
- `Show archived and excluded` makes all managed projects visible again.

These preferences do not delete history, stop tracking, or change analytical
totals. Collection exclusion remains controlled separately by
`devtracker.projectExclusionGlobs`.
