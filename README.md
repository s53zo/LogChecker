# Contest Log Workbench

A static, browser-based application for checking, editing, repairing,
converting, and scoring amateur-radio contest logs. Supported inputs include
Cabrillo, ADIF, plain text, and IARU Region 1 REG1TEST `.edi` VHF/UHF logs.

Open the hosted application: **https://s53zo.github.io/LogChecker/**

Log files are processed locally in the browser. The application has no backend
and does not upload log contents. Optional MASTER.DTA and CTY.DAT reference
files can be refreshed or selected locally.

## Local development

```bash
npm install
npm run dev
```

Create the static production site with `npm run build`. GitHub Pages publishes
the resulting `dist/` directory automatically after a push to `main`.
