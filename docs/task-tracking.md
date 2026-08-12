# VS Code Tasks tracking

DevTracker can record outcomes and durations for an explicit allowlist of VS
Code tasks. The integration is disabled by default and is independent from Git
and debug tracking.

## Configuration

Enable `devtracker.taskTrackingEnabled`, then add exact task names to
`devtracker.trackedTasks`:

```json
{
  "devtracker.taskTrackingEnabled": true,
  "devtracker.trackedTasks": [
    {
      "configuredName": "npm: build",
      "classification": "build"
    },
    {
      "configuredName": "npm: test",
      "classification": "test"
    }
  ]
}
```

Names are matched exactly after surrounding whitespace is removed from the
configured value. A task that is not in this allowlist is ignored. Duplicate
names, unsupported fields, invalid classifications, and more than 64 entries
are rejected by the runtime sanitizer.

Changing the allowlist, disabling task tracking, pausing DevTracker, or
deactivating the extension discards any in-flight observation. A task already
running at that boundary is not partially recorded.

## Collected data

DevTracker listens to VS Code's public task start, task end, and task process
end events. Each eligible completed observation stores only:

- the configured task name;
- its `build` or `test` classification;
- monotonic elapsed duration in integer milliseconds;
- one result: `succeeded`, `failed`, `cancelled`, or `unknown`.

An exit code of zero is `succeeded`; another numeric exit code is `failed`.
An observed process end without an exit code is `cancelled`. A task end without
a process-end event is `unknown`.

Task success rate is `succeeded / (succeeded + failed) * 100`. Cancelled and
unknown runs remain visible as separate outcomes and do not enter that
denominator. Median duration uses only succeeded and failed runs. Both derived
values are unavailable when no run has a numeric exit code.

The Workflow view shows success rate and median duration separately for every
configured task and classification in the selected project and date range.

## Privacy boundary

The task adapter reads only the public task name, workspace scope, lifecycle
events, and process exit code. It does not read or store task definitions,
commands, command arguments, variables, terminals, standard output, standard
error, problem-matcher output, or environment values.

Configured names are user-provided data and may themselves contain sensitive
text. Use neutral labels when needed. Records remain in DevTracker's VS Code
extension storage and leave the machine only through an explicit export.

## Limitations

- DevTracker observes only events emitted while the extension host is running.
- Global tasks are not attributed to a project and are ignored.
- A workspace-scoped task is attributed automatically only in a single-folder
  workspace. Folder-scoped tasks work in multi-root workspaces.
- A process can end without a numeric exit code, and some custom task providers
  emit no process event. These cases remain cancelled or unknown instead of
  being guessed as failures.
- A run is assigned to the local calendar day on which its task-end event is
  observed; its monotonic duration is never changed by wall-clock adjustments.
