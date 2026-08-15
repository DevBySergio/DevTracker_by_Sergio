# Trends dashboard

The Trends view explores time-based patterns for one selected project. It uses
the same typed range-query result as exports and does not read raw storage from
the webview.

## Ranges and comparison

Available ranges are 7 days, 30 days, 90 days, year to date, and a validated
custom calendar range. Custom end dates are capped at the current local date.
The selected view, project, range, and custom dates are kept in VS Code webview
state.

An equivalent previous-period comparison is shown only when the selected
current period is complete. A rolling range that includes today is explicitly
labelled as unavailable for comparison instead of comparing a partial day with
a complete historical day. A completed custom range compares with the same
number of immediately preceding calendar days.

## Metrics and visualizations

- Daily active time includes every calendar day in the range, including zero
  activity days.
- Flow blocks are shown as observed interaction-based blocks.
- File switches are normalized by active hours; a day with no active time is
  unavailable rather than reported as zero switches per hour.
- Consistency is the share of selected calendar days with active time.
- Goal days use the configured daily active-time goal. Goal completion is
  unavailable when no daily goal is configured.
- Current and longest streaks count consecutive selected days with active time.
- Language evolution uses per-day active-time distributions from schema-v2
  rollups and displays the five most active languages in the selected range.

The daily heatmap is a semantic table. Every Chart.js visualization also has a
native HTML table containing the same values, so the data remains available to
keyboard and assistive-technology users without relying on canvas pixels or
color alone.

## Privacy and payload boundary

Daily language entries contain only the VS Code language identifier and active
duration. The Trends projection receives per-day language distributions only
for the selected project. Source code, file contents, diagnostic messages,
terminal output, commands, and absolute paths are not included.
