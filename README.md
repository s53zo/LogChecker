# Amateur Radio Log Workbench

A static browser workbench for checking, editing, repairing, converting, and
preparing amateur-radio log files. Supported inputs include Cabrillo, ADI,
ADX/XML, plain text, and IARU Region 1 REG1TEST `.edi` VHF/UHF logs. Contest
scoring remains available, while [SH6](https://s53m.com/SH6) is recommended for
free online log analysis.

Open the hosted application: **https://s53zo.github.io/LogChecker/**

Log files are processed locally in the browser. The application has no backend
and does not upload log contents. Optional MASTER.DTA and CTY.DAT reference
files can be refreshed or selected locally.

## Preflight and log preparation

- ADIF 3.1.7 validation covers syntax, common data types and enumerations,
  dates/times, BAND/FREQ consistency, modes, grids, satellite dependencies, and
  version handling. Unknown and application-defined fields are preserved.
- Loss-conscious ADI/ADX import, editing, conversion, and export are available.
- Local destination profiles cover generic ADIF, LoTW/TQSL, Club Log, QRZ,
  POTA, SOTA, WWFF, and IOTA. See [the support matrix](docs/preflight-support.md)
  for exact support levels and limitations.
- Browser-local station profiles can be previewed before being applied, and
  logs can be split by station identity.
- The duplicate workbench classifies exact, LoTW, near, possible, and
  activity-aware candidates and makes every removal or merge undoable.
- Paper Logger includes structured entry and explicit fast-entry shorthand.
- Trusted S53ZO browser tools can hand an ADIF directly to the workbench with
  the optional automatic import setting. The Export screen checks the minimum
  QSL identity fields and can preload the working log into
  [ADIF to QSL Labels](https://s53zo.github.io/ADIF-to-QSL-label/make_qsl_labels.html).

Local preflight checks cannot guarantee acceptance by an external service.
Final LoTW signing and verification remains TQSL's responsibility.

## Local development

```bash
npm install
npm run dev
```

Use Node 22.18 or newer. Run the regression suite with `npm test`, source lint
and static safety checks with `npm run lint`, and all code checks plus the
production build with `npm run check`. The tests use Node's built-in test runner
and TypeScript support; no additional test framework is required.

Run browser checks with `npm run test:e2e`. This builds the app, starts and stops
its own production preview server, uses Chrome installed on the machine, and fetches the pinned optional
Playwright CLI into npm's cache on first use. It adds no application dependency.
Set `LOGCHECKER_BROWSER=chromium` to use an already installed compatible
Playwright Chromium instead. Actual downloads and desktop/mobile screenshots
are written to `output/playwright/`. Preview the built site with
`npm run preview`, then open `http://127.0.0.1:4173/`.

## Guided text and table import

Choose **Open → Paste a log** to reveal the paste form, or open a TXT, CSV, TSV, or
plain-text LOG file. The **Convert** workspace proposes column mappings using
headers and sampled field values. Existing ADIF/ADX, Cabrillo, and EDI files can
also use **Convert → Map fields and export**; the existing format editors remain
available.

1. Review the parsing method and its evidence. Delimited input supports quoted
   values, escaped quotes, and multiline records. Other choices include whitespace
   and fixed-width columns. Set a header line, use 0 for no header, or leave it
   blank for automatic detection. Add or adjust fixed-width boundary sliders.
2. Assign sent/received field meanings, inspect examples, and choose date order
   or frequency units when ambiguous. Columns can be split, combined, filled
   with an explicit constant, or ignored while retaining their source values.
3. Inspect source rows, exclude headers or summaries, and correct cells. The
   provenance table shows original values, normalized values, and transformations.
4. Choose ADIF, ADX, Cabrillo, EDI, or CSV, complete destination metadata, and
   validate the preview before downloading. Keep the JSON conversion report for
   complete source, unmapped values, decisions, and format losses.

All material mapping, row, metadata, and preset changes support Undo/Redo in the
active session. History retains up to 30 steps, reducing to at least two for large
sources to bound retained memory. Personal mapping presets stay in browser storage and may contain
the constant values configured by the user. Preset application is explicit;
matching column counts alone never establishes equivalent field meanings.
New presets retain the column-construction recipe, including added constants,
splits and joins. The recipe is validated and replayed against matching original
columns before final mappings are applied. Older mapping-only presets still load.
Editing the native document invalidates its older mapping session; reopen field
mapping from Convert to work from the corrected document revision.

### Recovery and confidence

Structural scores rank candidate interpretations using consistent widths,
recognized headings, and recognizable values. Field confidence distinguishes
explicit headings, value-based suggestions, and ambiguous fields. These scores
are heuristic evidence, not calibrated probabilities of correctness.

Automatic normalization includes casing, date/time punctuation, mode aliases,
decimal commas, unambiguous frequency units, and band derivation. Unsupported
values and ambiguous dates/units remain errors for review. Callsigns, missing
exchanges, station identity, timezone offsets, and points are never invented.

**Try automatic recovery** runs the target validator over at most eight candidate
interpretations. An alternative cannot drop, add, reorder, or change original
QSO coverage to obtain a passing result. Manual mapping and value changes lock
the current interpretation. The conversion report includes attempted candidates
and their validation results. Malformed quoting must be corrected in the raw
source or handled with the correct parsing strategy.
Native ADIF frequencies retain their declared MHz units. Conflicting explicit
and derived mode/submode values require review. ADX parsing validates the whole
XML document; incomplete records and XML-forbidden characters block conversion.
Correctable native field errors are rechecked after edits, with historical
diagnostics retained in the report rather than permanently blocking export.
CSV output prefixes potentially active spreadsheet formulas with an apostrophe;
the report preserves exact originals and identifies each protective change.

### EDI and contest metadata

The supplied S53ZO grouped logger layout is a built-in, data-described preset.
The fixture yields 28 ordered contacts, 3,877 supplied points, station S53ZO in
JN86CR on 144 MHz, and ODX IQ5NN / JN63GN / 455 km. USB and CW map to EDI 1 and 2.

EDI start/end dates default to the earliest/latest selected valid QSO dates,
or the contest dates already present in a native log header. You can edit either
date without losing the other default; use an override if the official contest
period extends beyond your operating time. The additional station exchange
(`PExch`, for example a county or DOK) is optional: leave it blank for logs
containing only RST, serial numbers and locators, which have separate fields.
Confirm UTC and select either supplied-point
scoring or an explicit claimed score. Points are preserved; calculated locator
distance is used only for ODX, never silently substituted for QSO points.
Mixed station identities, locators, or bands must be resolved before a single
EDI export. Contest-specific multipliers must be supplied explicitly.
Supplied band multipliers are preserved. A retained native mode code that
conflicts with an edited mode must be resolved before EDI download.

### Boundaries

The parser supports text tables and the native formats above, not arbitrary
binary files, images, or OCR. Unknown logger layouts can be configured manually.
Parsing is capped at 5 million characters, 50,000 records, 256 columns, and
1 million editable cells, including native structured imports;
oversized inputs receive an explicit error. The preview paginates source rows
and caps displayed output while downloads retain the complete selected log.
Native sources are prepared in a local module worker before allocating their
table. Inputs above 100,000 characters or tables above 100,000 cells also run
normalization, recovery, and export in a worker. Text edits are debounced.
Structural changes complete before dependent actions such as Preview; controls
that depend on column positions pause until the new structure is available.
Other superseded jobs are cancelled, and stale results cannot replace newer
choices. Workers terminate when finished. Destination-loss details display at
most 100 entries; the downloadable report retains the complete list.
The browser check includes an actual 10,000-contact worker export while offline.
The service worker caches the import worker on first load alongside the app.
Native source syntax errors require repairing the source and reopening the
mapping workflow. Local validators check documented format constraints but
cannot guarantee contest-organizer acceptance.

Format references: [IARU Region 1 VHF Handbook](https://www.iaru-r1.org/wp-content/uploads/2024/11/VHF_Handbook_V10_02.pdf),
[Cabrillo specification](https://wwrof.org/cabrillo/), and
[ADIF specification](https://www.adif.org/).

The production output is the static `dist/` directory. It can be published by
GitHub Pages without a server. The service worker assets generated by the
existing build make core workflows available after the site has loaded once.

## Privacy

Log contents, station profiles, fast-entry drafts, callsigns, coordinates, and
diagnostics remain on the device. The app has no upload backend. Its only data
requests are the visible MASTER.DTA and CTY.DAT refreshes. Google Analytics may
receive generic feature/action names and coarse record-count buckets, but never
filenames, callsigns, log values, profile names, searches, or free text.
Browser-to-browser ADIF handoff uses a restricted `postMessage` origin; log
content is never placed in a URL or analytics event.

## Extending the workbench

- Add ADIF field rules in `src/core/adif-schema.ts` and back every new rule with
  valid and invalid fixtures.
- Add destination checks as a profile in `src/core/preflight.ts`; include its
  official source, review date, support level, and golden tests.
- Add fast-entry tokens in `src/core/fast-entry.ts`; tokens must be explicit,
  preserve unparseable source, and expose inherited values.
- Cabrillo templates remain generated from the recovered template definitions
  and must include parser/serializer fixtures before being advertised.
