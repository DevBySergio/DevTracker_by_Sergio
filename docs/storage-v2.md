# DevTracker schema v2 storage

Schema v2 is rooted at `ExtensionContext.globalStorageUri/v2`. It is additive
to the immutable v1 source at `~/.devtracker/data.json`; schema v2 never
modifies that file.

## Layout

```text
v2/
  metadata/
    schema.json
  sessions/
    active/
      session-<uuid>.json
    completed/
      session-<uuid>.json
  rollups/
    <project-id>/
      YYYY-MM-DD.json
  backups/
    legacy-data-<timestamp>-<uuid>.json
    quarantine/
      corrupt-legacy-data-<timestamp>-<uuid>.json
  compatibility/
    data.json
```

`metadata/schema.json` contains `schemaVersion: 2` and the project-identity
registry. Each extension-host activation creates a new instance ID and an
independent active session file. Completing the host moves only that session to
`sessions/completed`; concurrently active hosts cannot overwrite one another.

Daily rollups are separate from session records so range queries do not need to
rewrite or scan active sessions. Project identity, interval attribution, and
rollup semantics follow the [metric contract](metric-contract.md).

## Legacy migration

Activation detects the v1 file in the user profile and creates a byte-preserving
private backup before parsing it. Valid days are strictly normalized and mapped
to deterministic schema-v2 rollup keys with `legacyApproximate: true`; values
that cannot be reconstructed safely remain zero or empty rather than gaining
invented precision. Repeating the migration overwrites those keys and never
adds the same historical totals twice.

If the source is corrupt, its bytes are copied to quarantine and the newest
semantically valid backup is used. The corrupt original remains in place. A
separate compatibility snapshot under global storage supports the transitional
dashboard; it is seeded only if absent while holding the asynchronous legacy
write lock, so concurrent extension hosts cannot duplicate the seed.

## Records

| Record | Purpose |
| --- | --- |
| `SchemaMetadataV2` | Schema version, timestamps, and the registry of `ProjectIdentity` records |
| `ProjectIdentity` | Stable SHA-256 project ID and canonical URI metadata |
| `TrackingSession` | One extension-host lifetime with its own instance ID, lifecycle timestamps, and intervals |
| `ActivityInterval` | A closed wall-clock and monotonic interval attributed to one project and optional document/language |
| `DailyRollup` | Contracted per-project, per-local-day counters, diagnostic rollups, and time distributions |

All records have exact key sets and `schemaVersion: 2`. Readers reject unknown
keys, missing keys, unsafe identifiers, invalid dates, negative or non-integer
counters, invalid lifecycle combinations, reversed intervals, duplicate
interval IDs, mismatched session IDs, and references to unknown projects.
Unavailable values use explicit `null` fields defined by the record; validation
does not convert missing or invalid data to zero.

## URI identity

Project and document IDs are SHA-256 hashes of canonical URIs with a type
prefix. File URIs use `realpath` when available. POSIX path case is preserved;
on Windows only the drive letter is normalized, so unrelated case-sensitive
segments are never universally lowercased. Non-file URI schemes are normalized
without local filesystem calls, which keeps remote and virtual workspaces
compatible. Multi-root folders and projects that share a basename remain
distinct because the complete canonical URI participates in the hash.

Analytical rollups use privacy-mode-aware document identities as map keys.
Relative mode permits only normalized project-relative paths; hashed mode uses
a profile-salted identifier; `none` stores no document dimension. Strict
validation rejects absolute paths, traversal segments, backslashes, NUL bytes,
and empty path segments.

## Range queries

The typed range-query service reads only the requested project/date rollup
keys. It supports today, rolling 7-, 30-, and 90-day ranges, the current year,
and validated custom calendar ranges. Future custom end dates are clamped to
today, future starts are rejected, and the returned day and real local
15-minute timelines include explicit zero entries. Daylight-saving transitions
therefore produce the actual 23-, 24-, or 25-hour local-day bucket count while
retaining each bucket's UTC offset.

An indexed aggregation engine builds typed day, project, language, document,
and quarter-hour view models. Diagnostic current snapshots are replaced rather
than summed through time; introduced/resolved counts are additive and peaks use
`max`. Equivalent previous-period comparison is returned only when the current
calendar period is complete. Identical queries are cached, and a changed daily
rollup invalidates the cache through the store's in-process revision without
causing an all-history traversal.

Complete-history export is the one operation that scans retained rollup file
names to determine the earliest and latest local dates. It then uses the same
strict range reader and aggregation path as selected-range export; routine
dashboard queries never perform that scan.

## Writes, flushing, and permissions

Schema-v2 writes are asynchronous and record-scoped. Repeated updates to the
same metadata, session, or rollup record are coalesced for ten seconds, while
different record keys remain independent. A single write queue serializes the
resulting operations, writes JSON to a sibling temporary file, applies the file
mode, and atomically renames it into place. Completing a session writes the
final completed record before removing its active record.

A forced `flush()` is used for lifecycle boundaries. Failed and unattempted
records remain queued for retry; callers can inspect `getPersistenceHealth()`
to distinguish idle, pending, writing, and failed states and to see the number
of outstanding record writes. Tracking mutations update memory immediately,
so extension-host event handlers never wait for disk I/O.

On POSIX platforms, every schema-v2 directory is hardened to `0700` and every
JSON or temporary file to `0600`, including pre-existing paths revisited during
initialization. Windows receives the platform's normal user-profile ACLs; POSIX
mode bits are not treated as an equivalent Windows security mechanism.

No diagnostic message, source content, terminal content, command, debug launch
configuration, credential, or secret is part of any schema-v2 record.
