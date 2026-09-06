# Resilient log import implementation

The scope is the complete pasted-text objective supplied on 2026-09-06. Existing
structured editing and legacy character-table operations remain supported.

## Delivery sequence

1. Establish executable dependency-free Node regression tests and the original
   S53ZO fixture. Record the current build baseline before changing behavior.
2. Introduce a source-preserving import session, bounded structural candidates,
   semantic mappings, normalization, and per-value provenance.
3. Project canonical records into ADIF/ADX, Cabrillo, EDI, and CSV; validate
   outputs and expose blocking ambiguity, metadata gaps, losses, and repairs.
4. Integrate a responsive import workspace with candidate selection, fixed-width
   boundaries, mapping, transformations, row decisions, local presets, full
   session undo/redo, previews, downloads, and recovery reports.
5. Exercise fixture, fuzz, large-input, security, round-trip, and browser flows;
   repair failures and document supported behavior and limits.

## Verification evidence required

- Every input row remains accounted for, including excluded and invalid rows.
- No semantic value is invented to make output pass validation.
- User mapping and value overrides survive recovery; recovery is bounded.
- S53ZO: 28 ordered QSOs, JN86CR, 144 MHz, 3877 supplied points, correct modes
  and serials, IQ5NN / JN63GN longest contact with independently derived distance.
- Missing contest identity/dates/time basis/scoring configuration remains visible.
- Structural/manual/mapping/repair/preset operations are reversible.
- Existing parse/serialize and editing regressions pass.
- Node tests, TypeScript, static checks, production build, and rendered desktop
  and mobile import/correct/preview/download flows are verified.

## Initial evidence

Clean worktree. No checked-in tests or scripts; these paths were globally ignored.
Package test scripts referenced undeclared Vitest and Playwright. Use built-in
Node test support and the existing TypeScript toolchain without new dependencies.

## Delivered architecture

- `src/core/ingestion-types.ts`, `src/core/ingestion.ts`: immutable source,
  candidate evidence, data-defined logger preset, canonical values and provenance.
- `src/core/import-structured.ts`, `src/core/import-export.ts`: native adapters,
  shared validated exports, explicit contest/scoring gates and coverage-safe recovery.
- `src/core/import-workspace.ts`: reversible mapping/row/metadata operations,
  validated local presets, bounded history and JSON recovery reports.
- `src/core/import-tasks.ts`, `src/core/import-worker.ts`: cancellable local worker
  jobs for large sources, with stale-result protection.
- `src/ui/import-view.ts`, `src/ui/import-controller.ts`, `src/import.css`:
  responsive structure/mapping/rows/export workflow and browser event handling.
- `src/main.ts`, `src/core/format.ts`, `src/styles.css`, `index.html`, `public/sw.js`:
  paste/upload integration, plain-text LOG recognition, responsive shell repair,
  local icon, and first-load worker caching without deleting other apps' caches.
- `scripts/register-ts.mjs`, `scripts/check-source.mjs`,
  `scripts/browser-check.mjs`, `package.json`, `package-lock.json`, `.gitignore`:
  executable tests, static checks, browser verification, and tracked tooling.
- `tests/*.test.mjs`, `tests/fixtures/*`, `README.md`: regression corpus,
  end-user workflow, format references and explicit limits.

## Acceptance audit

The fixture tests cover each parsing family, generic and grouped headings,
manual boundaries, ambiguous dates/units, shifts/missing cells, malicious quotes,
unknown fields, mixed bands, native round trips, and bounded fuzz/large inputs.
Workspace tests cover mapping, transformations, constants, row repair, presets,
undo/redo, revoked storage, source provenance and locked recovery.
Exporter tests run the actual target parsers/validators and cover all five output
types, EDI serials/mode codes/flags/scoring declarations, metadata conflicts,
injection rejection, and recovery that cannot improve validation by dropping rows.

The browser script uploads the original S53ZO fixture, configures EDI metadata,
downloads and reads its real output (28 rows, 3877 points, IQ5NN/JN63GN/455),
checks 375/414/768/1024/1440 widths, pastes an invalid contact, corrects it,
tests undo/redo gating, downloads ADIF/ADX/CSV plus its provenance report, and
downloads all 10,000 contacts from a background worker import while offline.

Initial verification: 80 passing tests; source lint/static checks and TypeScript
pass; production build passes; production browser checks pass at all five widths,
including actual EDI and offline worker downloads. No skipped or failing tests.

The subsequent independent SWE audit uncovered 15 gaps that the initial tests
missed. All are now addressed; see `AUDIT-FIXES.md` for the fix/verification map.
The expanded suite has 113 passing tests, and the production browser scenarios
and independent cross-reviews pass.

Output evidence is in `output/playwright/`; visual assessment is persisted under
`.omx/state/import/ralph-progress.json`. Local tests do not certify organizer
acceptance. Native syntax errors, ambiguous semantics, unknown layouts and
contest-specific declarations remain explicit review tasks. Input limits and
history bounds are documented in README. The pre-existing main-bundle size
advisory remains a build warning, not a validation failure.
