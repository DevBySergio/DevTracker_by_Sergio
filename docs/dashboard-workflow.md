# Workflow dashboard

The Workflow view groups descriptive editor signals and optional development
integrations for one selected project and date range. It does not calculate or
display a productivity, quality, or focus score.

## Descriptive metrics

- Diagnostics show current, introduced, resolved, and peak counts. The detail
  table keeps errors, warnings, information, and hints separate. DevTracker
  stores counts only; diagnostic messages and source code are never retained.
- Character edit volume is inserted plus removed characters. Saves are event
  counts and, when active time is available, saves per active hour. Neither is
  interpreted as code quality.

## Optional integrations

Git, Debug, and VS Code Tasks remain independently disabled by default. Each
panel explains its privacy boundary before linking to the relevant DevTracker
setting:

- Git retains local branch names, commit-event counts, and dirty-file
  aggregates. It never stores file contents or commit messages.
- Debug retains aggregate elapsed and active debug time. It never stores launch
  names, configurations, arguments, or session IDs.
- Tasks retains outcomes and durations only for exact task names explicitly
  configured in `devtracker.trackedTasks`. It never reads or stores commands,
  variables, terminals, or output.

The panels distinguish disabled, unavailable, no-repository, setup-required,
no-data, and available states. Enabling one integration never enables another.
