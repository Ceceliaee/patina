# Remove the Tools timer module

The requested scope removes stopwatch and countdown, renames the Chinese reminder
section to 提醒, and retains reminders and Pomodoro.

- Remove the timer UI, preferences, runtime state, IPC commands, Mini projection,
  persistence and backup fields, translations, and dedicated tests.
- Retire the timer tables with a database migration. Keep
  historical migrations so existing databases can still upgrade.
- Check remaining consumers and run focused type, runtime, migration, and backup
  checks before the required wider validation for the finished change.

## Implementation

The Tools navigation now contains Reminder and Focus. Timer state, commands,
permissions, alerts, Mini projections, backup fields and timer-only copy, styles
and tests were removed. Migration 22 drops the timer and lap tables. Historical
migration SQL remains unchanged to preserve installed migration checksums.

Application and website transition notifications now live with the existing
usage-reminder schedule. This keeps those entry points out of the main runtime
without adding a forwarding implementation or changing their behavior.

The scope preserves the reminder and usage-limit changes already in the working
tree. It does not update dependencies or relax quality budgets.

## Validation

- Type, lint, localization, architecture, IPC, Quiet Pro and test-governance checks
  passed. The IPC inventory contains 106 platform calls and 108 commands.
- Frontend unit tests, coverage thresholds and mutation checks passed. All 227
  browser scenarios passed after removing obsolete three-module assertions.
- Rust compile, tests and clippy passed: 910 library tests, 8 registered ignored
  tests, the native-probe integration test and 9 additional tests.
- Upgrade tests verify that existing stopwatch/countdown data and laps are
  removed, reminder and Pomodoro data survive, historical migration checksums
  remain unchanged, and repeated startup does not recreate timer tables.
- Backup tests include an old snapshot with timer data and verify retirement
  during source preparation.
- The production frontend build passed. The bundle gate failed because the
  existing QuietTimePicker chunk is 2.02 KiB gzip and does not retain the required
  3% headroom below its 2.04 KiB budget.
- The hotspot gate still reports 3 dependency owners in the tools runtime against
  a budget of 2. Its production line count is now 647, within the 650-line limit.
  Further restructuring belongs to the tools runtime owner.
- Rust dependency auditing passed. The online JavaScript audit reports two
  existing moderate advisories: GHSA-g3hv-75wg-m249 (minimatch) and
  GHSA-3g3m-2fjr-6pw4 (glob). Dependency updates remain a separate lockfile task.

Desktop contracts, data recovery, storage restart, WebView recovery and window
lifecycle passed using the isolated prepared runtime. The recovery assertion
checks migration 22 and the absence of both timer tables.

Mini native input validation could not complete: Windows rejected the probe's
cursor move with `Cannot move to owned input target`. The isolated process was
cleaned up. This leaves Mini input acceptance unresolved with the native runtime
validation owner; it requires an available interactive desktop before another
run can establish evidence.

Implementation is complete. The full gate has not passed because Mini input
evidence and the budget and dependency findings above remain unresolved. These
follow-ups retain their existing owners; this removal does not relax their gates.
