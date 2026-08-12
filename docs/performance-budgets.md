# Large-history performance budgets

DevTracker keeps a deterministic scalability fixture in
`src/test/largeHistoryFixture.ts`. It covers 2023-01-01 through 2025-12-31:

- 1,096 calendar days, including the 2024 leap day
- 50 projects
- 54,800 daily rollups, one for every project and calendar day
- deterministic activity on weekdays and zero-valued weekend rollups
- one language, one retained document identity, and one quarter-hour bucket
  for each active project-day

This shape keeps storage and query cardinality fixed while producing a
representative sustained-work payload. The fixture deliberately avoids random
values so a regression is reproducible.

## What is measured

The repeatable suite measures the history-dependent activation work (building
the in-memory analytical index from already-loaded v2 rollups), cold 7-day,
30-day, 90-day, and three-year queries, and the global dashboard's initial
90-day snapshot and subsequent one-rollup delta.

The activation number does not include VS Code process startup, extension-host
loading, migration, or physical disk latency. Those concerns vary by host and
belong in extension-host integration coverage; this budget isolates the work
whose cost scales directly with retained history.

Run the suite with:

```sh
npm run test:performance
```

It also runs through the normal `npm test` discovery because its filename ends
in `.test.ts`.

## Baseline and enforced budgets

The baseline below is a single local run on 2026-08-12 using Node.js 22.14.0,
macOS 26.5.2, and arm64. Elapsed results are observations, not promises for a
specific machine.

| Operation | Observed baseline | Enforced elapsed ceiling | Exact structural or byte budget |
| --- | ---: | ---: | ---: |
| Analytical index hydration | 201.0 ms | 5,000 ms | 54,800 rollup upserts |
| Cold 7-day query | 10.3 ms | 1,000 ms | 350 record lookups |
| Cold 30-day query | 12.8 ms | 1,500 ms | 1,500 record lookups |
| Cold 90-day query | 23.1 ms | 2,500 ms | 4,500 record lookups |
| Cold three-year query | 236.0 ms | 8,000 ms | 54,800 record lookups |
| Initial 90-day global snapshot | 83,395 bytes | n/a | at most 102,400 bytes |
| One-rollup live delta | 2,437 bytes | n/a | at most 10,240 bytes |

The exact lookup budgets are the primary algorithmic guard. They prove that a
query touches only the requested date/project keys: `days × projects`. The
elapsed ceilings intentionally leave substantial headroom for shared CI,
instrumented runtimes, and noisy developer machines while still detecting a
large regression. Protocol byte ceilings are hard product limits and match the
host-side validation constants.

## Update and I/O guarantees

The payload test changes one rollup after the initial 90-day snapshot and
requires the resulting live message to:

- remain under the 10 KiB delta limit;
- contain exactly one day upsert and no day removals; and
- omit the beginning of the three-year fixture, proving that a live update does
  not resend full history.

For the global view, only the top-three file distribution crosses the protocol
boundary because that view consumes it solely for the top-three focus metric.
Project views keep their complete retained file distribution.

The suite also scans the extension, tracking, dashboard protocol, presentation,
report-panel, and workspace-identity handler modules for direct synchronous
filesystem calls. Persistence initialization may use its own storage adapters,
but event and protocol handlers must not introduce synchronous filesystem I/O.

When the fixture or a wire shape changes intentionally, record a fresh baseline
from a quiet local run, explain the cardinality change here, and adjust an
enforced ceiling only when the new behavior is expected and reviewed.
