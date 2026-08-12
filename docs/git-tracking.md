# Git tracking

Git tracking is a local, opt-in integration controlled by
`devtracker.gitTrackingEnabled`. It is disabled by default and independent from
the debug and Tasks settings.

## Repository model

DevTracker uses VS Code's built-in Git extension API. It subscribes to
repository open, close, state, checkout, and commit events instead of polling
on the activity timer. Every open repository has an independent in-memory
snapshot keyed by repository URI. For a document inside nested repositories,
the repository with the longest containing root is selected.

The current dirty-file count is the number of unique resource URIs across the
working tree, index, merge, and untracked status groups. A resource present in
more than one group contributes once.

## Stored aggregates

When enabled, daily schema-v2 rollups may contain:

- `gitStatus`: `disabled`, `unavailable`, `no-repository`, or `available`.
- `gitDirtyFiles`: the latest unique dirty-file snapshot.
- `gitBranchChanges`: observed branch-name transitions after initial discovery.
- `gitDetectedCommits`: built-in Git commit events deduplicated by the current
  HEAD identifier.
- `activeTimeByGitBranchMs`: active interval time attributed to the selected
  repository branch.

Detached and unborn HEAD states use explicit display names. Disabled,
unavailable, and no-repository states do not accumulate branch time. Branch
names are retained because they are the requested analytical dimension; users
who do not want branch names stored should leave Git tracking disabled.

Repository roots, dirty resource URIs, commit identifiers, commit messages,
authors, diffs, and file content are not persisted. Git observations never
leave the local DevTracker storage and are included in exports only when the
user explicitly runs an export command.

## Lifecycle and failure behavior

Changing the setting disposes existing subscriptions and starts a new
configuration generation. An older asynchronous Git activation result is
ignored if the setting changes or the integration is disposed before it
finishes. Closing a repository removes its snapshot immediately.

The Workflow view distinguishes disabled tracking, an unavailable built-in Git
integration, a project without a containing repository, and an available
repository with no branch activity in the selected range.
