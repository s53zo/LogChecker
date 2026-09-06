# Independent SWE audit fixes

Scope: all 15 findings from the independent parser, export, UI/worker, and
security reviews. Keep the original source and existing worktree changes.

| # | Finding | Fix ownership / verification |
|---|---|---|
| 1 | Malformed ADX drops records | XML/native parser + malformed XML tests |
| 2 | Summary heuristic excludes valid CSV contacts | Parser + reordered-column fixtures |
| 3 | Native ADIF frequency units guessed | Native adapter + MHz preservation tests |
| 4 | Derived submode overwrites explicit submode | Normalizer + both column orders |
| 5 | Native editor changes leave stale mapper | Main document revision invalidation + browser editor/map flow |
| 6 | Large structural edit cancelled by Preview | Controller sequencing + deterministic workers + browser blur/preview |
| 7 | Native EDI code overrides changed mode | Export conflict validation + source/canonical mode tests |
| 8 | Supplied EDI multiplier overwritten | Export preservation/scoring validation tests |
| 9 | Structural mapping presets not reusable | Safe recipe replay + constant/split/join/history tests |
| 10 | Corrected native values remain blocked | Separate source syntax from current value diagnostics |
| 11 | CSV formulas active on spreadsheet open | Safe CSV cells + exact JSON originals tests |
| 12 | Forbidden XML characters exported as valid | XML character validation + ADX export rejection tests |
| 13 | Structured import dimensions unbounded | Pre-allocation source/row/column/cell bounds + worker selection tests |
| 14 | Unbounded export loss list rendering | Capped view + full report preservation tests |
| 15 | First text edit leaves Undo disabled | Targeted DOM state updates + controller/browser assertions |

Work sequence: write targeted failing regressions, implement within independent
file ownership, integrate shared contracts, run the full test/type/static/build
checks, run production browser tests including offline workers, then review the
fixes against the original reproductions. No changes are considered verified
solely because the earlier 80 tests passed.

## Final status

All 15 findings are addressed and covered by targeted regressions. The first
cross-review identified a stale-index variant of finding 6; this was fixed by
pausing indexed controls during structural work and rejecting old-schema events.
A second independent replay confirmed that fix. All four cross-review lanes
passed without remaining findings in the audited scope.

Verification: 113/113 tests pass; lint/static safety checks, TypeScript, production
build and `git diff --check` pass. Production browser checks cover all five
responsive widths, actual EDI/ADIF/ADX/CSV downloads, source correction/history,
10,000-contact offline worker export, header blur immediately followed by Preview,
first-edit Undo availability, and native editor → mapper revision invalidation.

Changed production areas: native XML parsing and shared import limits;
tabular classification and canonical provenance; export safety and EDI consistency;
validated structural preset replay; worker routing and UI sequencing; editor
revision binding and bounded destination-loss rendering. New tests are in
`tests/*audit-fixes.test.mjs` and `tests/audit-integration.test.mjs`, with expanded
browser coverage in `scripts/browser-check.mjs`. README documents the updated
limits and recovery behavior. No new application dependencies were introduced.

Deliberate behavior: malformed source fragments still require source repair;
conflicting EDI mode/code fields block until resolved; spreadsheet-safe CSV may
prefix an apostrophe while the report preserves the original. The existing main
bundle-size advisory remains non-blocking.
