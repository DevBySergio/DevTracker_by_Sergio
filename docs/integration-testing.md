# Extension Host integration testing

Run the real VS Code integration suite with:

```sh
npm run test:integration
```

The command uses a local Visual Studio Code or Visual Studio Code Insiders
installation when one is available and downloads the stable test runtime on CI
or other hosts. It creates isolated temporary workspaces, user-data directories,
extension directories, and home directories, then removes them after the run.
The test host uses the basic password store inside that disposable profile so it
does not access the developer's normal keychain. It never reads or modifies the
developer's normal VS Code profile.

The suite launches three extension-host phases:

1. **Empty startup** activates DevTracker with no editor, verifies the zero-data
   query, and opens the dashboard without recent activity.
2. **Real events** uses a multi-root workspace to exercise edits, saves,
   selections, editor and project switches, pause/resume, configuration
   exclusions, diagnostic changes, Git unavailable/available/no-repository
   states, and an allowlisted VS Code task.
3. **Reload** verifies that the preceding host's deactivation completed its
   pending write, retained diagnostic transitions, and preserved task metrics.

The integration fixture deliberately leaves one final metric write unflushed.
The next host compares persisted metrics with an expectation captured from the
previous host's in-memory view. This ensures VS Code awaits DevTracker's
`deactivate()` promise and that shutdown drains queued storage writes.
