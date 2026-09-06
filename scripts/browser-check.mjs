import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// The browser CLI is optional verification tooling, fetched into npm's cache;
// it is not a runtime or application dependency.
const session = `logchecker-check-${process.pid}`;
const port = 5189;
const url = `http://127.0.0.1:${port}`;
const cli = (...args) => {
  let output;
  try { output = execFileSync('npx', ['--yes', '--package', '@playwright/cli@0.1.19', 'playwright-cli', `-s=${session}`, ...args], { encoding: 'utf8', timeout: 180_000, maxBuffer: 8_000_000 }); }
  catch (error) { throw new Error(String(error.stdout || error.stderr || error.message).slice(0, 5000)); }
  if (/### Error/.test(output)) throw new Error(output);
  return output;
};
const server = spawn('npm', ['run', 'preview', '--', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: process.platform !== 'win32' });
await mkdir('output/playwright', { recursive: true });
await writeFile('output/playwright/large-source.csv', ['Date,Time,Call,Mode,Freq,Comment', ...Array.from({length:10000}, (_,i) => `20260906,1238,S53O,USB,144.3,Contact ${i}`)].join('\n'));
await writeFile('output/playwright/editor-source.adi', '<ADIF_VER:5>3.1.7<EOH>\n<CALL:4>S53O<QSO_DATE:8>20260906<TIME_ON:4>1238<MODE:3>SSB<FREQ:5>144.3<EOR>\n');
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(url)).ok; } catch { /* Wait for this server only. */ }
    if (ready) break;
    if (server.exitCode !== null) throw new Error('Test server exited before becoming ready.');
    await delay(200);
  }
  if (!ready) throw new Error('Test server did not become ready.');
  cli('open', url, '--browser', process.env.LOGCHECKER_BROWSER ?? 'chrome');
  const pasted = 'Date\tTime\tCall\tMode\tFreq\tComment\n20260906\t1238\t???\tUSB\t144399,90\t<pasted & preserved>';
  const code = `async page => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    assert(await page.getByRole('textbox', {name:'Pasted log text',exact:true}).count() === 0, 'Paste panel must start hidden');
    await page.getByRole('button', {name:'Paste a log',exact:true}).click();
    await page.getByRole('textbox', {name:'Pasted log text',exact:true}).fill('Draft retained after closing');
    await page.getByRole('button', {name:'Cancel',exact:true}).click();
    assert(await page.getByRole('textbox', {name:'Pasted log text',exact:true}).count() === 0, 'Cancel must hide paste panel');
    await page.getByRole('button', {name:'Paste a log',exact:true}).click();
    assert(await page.getByRole('textbox', {name:'Pasted log text',exact:true}).inputValue() === 'Draft retained after closing', 'Paste draft must survive closing');
    await page.getByRole('button', {name:'Cancel',exact:true}).click();
    await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/s53zo-20260906.txt');
    await page.getByRole('region', {name:'Advanced log import'}).waitFor();
    assert((await page.locator('.import-summary strong').first().textContent()) === '28', 'Expected 28 contacts');
    await page.getByRole('combobox', {name:'Output format',exact:true}).selectOption('edi');
    await page.getByRole('button', {name:'Use consistent station values'}).click();
    await page.getByRole('textbox', {name:'Contest name / identifier'}).fill('IARU Region 1 VHF');
    assert(await page.locator('[data-import-value="contestStart"]').inputValue() === '20260906', 'Start date must default from the log');
    assert(await page.locator('[data-import-value="contestEnd"]').inputValue() === '20260906', 'End date must default from the log');
    await page.getByRole('checkbox', {name:'I confirm the logged times are UTC'}).check();
    await page.getByRole('combobox', {name:'Scoring rules'}).selectOption('supplied-points');
    await page.getByRole('button', {name:'Validate & preview',exact:true}).click();
    assert(await page.getByRole('button', {name:'Download log',exact:true}).isEnabled(), await page.locator('.import-result').innerText());
    const edi = await page.locator('.import-result pre').textContent();
    assert(edi.includes('PExch='+String.fromCharCode(10)) || edi.includes('PExch='+String.fromCharCode(13)), 'Additional exchange must remain blank without blocking download');
    assert(await page.locator('.import-result li').count() === 2, 'Expected two concise EDI representation notes');
    assert(edi.includes('CQSOP=3877') && edi.includes('[QSORecords;28]') && edi.includes('CODXC=IQ5NN;JN63GN;455'), 'EDI acceptance values missing');
    const download = page.waitForEvent('download');
    await page.getByRole('button', {name:'Download log',exact:true}).click();
    await (await download).saveAs('output/playwright/s53zo.edi');
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:'output/playwright/import-desktop.png'});
    for (const width of [375,414,768,1024,1440]) {
      await page.setViewportSize({width,height:900});
      if (width === 375) { await page.evaluate(() => window.scrollTo(0,0)); await page.screenshot({path:'output/playwright/import-mobile.png'}); }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Horizontal page overflow at '+width+' '+JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1 && el.getBoundingClientRect().width > 0).slice(0,10).map(el => [el.tagName,el.className,Math.round(el.getBoundingClientRect().right)]))));
      assert(await page.getByRole('button', {name:'Download log',exact:true}).isEnabled(), 'Download inaccessible at '+width);
      if (width === 375) { await page.evaluate(() => window.scrollTo(0,0)); await page.screenshot({path:'output/playwright/import-mobile.png'}); }
    }
    // Exercise a pasted malformed contact on the smallest viewport, fix it,
    // undo/redo the correction, and verify download gating.
    await page.setViewportSize({width:375,height:900});
    await page.getByRole('button', {name:'Open',exact:true}).click();
    await page.getByRole('button', {name:'Paste a log',exact:true}).click();
    await page.getByRole('textbox', {name:'Pasted log text',exact:true}).fill(${JSON.stringify(pasted)});
    await page.getByRole('button', {name:'Inspect pasted text',exact:true}).click();
    await page.getByRole('checkbox', {name:'I confirm the logged times are UTC'}).check();
    await page.getByRole('button', {name:'Validate & preview',exact:true}).click();
    assert(await page.getByRole('button', {name:'Download log',exact:true}).isDisabled(), 'Malformed callsign must block');
    await page.locator('.import-stage > summary').filter({hasText:'Rows & provenance'}).click();
    await page.locator('.import-row > summary').filter({hasText:'Line 2'}).click();
    await page.getByRole('textbox', {name:'Line 2, column 3',exact:true}).fill('S53O');
    await page.getByRole('button', {name:'Validate & preview',exact:true}).click();
    assert(await page.getByRole('button', {name:'Download log',exact:true}).isEnabled(), 'Corrected contact must export: '+await page.locator('.import-result').innerText());
    await page.locator('.import-workspace').getByRole('button', {name:'Undo',exact:true}).click();
    await page.getByRole('button', {name:'Validate & preview',exact:true}).click();
    assert(await page.getByRole('button', {name:'Download log',exact:true}).isDisabled(), 'Undo must restore original invalid value');
    await page.locator('.import-workspace').getByRole('button', {name:'Redo',exact:true}).click();
    for (const format of ['adif','adx','csv']) {
      await page.getByRole('combobox', {name:'Output format',exact:true}).selectOption(format);
      await page.getByRole('button', {name:'Validate & preview',exact:true}).click();
      assert(await page.getByRole('button', {name:'Download log',exact:true}).isEnabled(), 'Expected '+format+' export');
      const pending = page.waitForEvent('download');
      await page.getByRole('button', {name:'Download log',exact:true}).click();
      await (await pending).saveAs('output/playwright/corrected.'+format);
    }
    const report = page.waitForEvent('download');
    await page.getByRole('button', {name:'Conversion report',exact:true}).click();
    await (await report).saveAs('output/playwright/conversion.json');
    await page.context().setOffline(true);
    await page.locator('input[type=file]').first().setInputFiles('output/playwright/large-source.csv');
    await page.waitForFunction(() => document.querySelector('.import-summary strong')?.textContent === '10000');
    assert((await page.locator('.import-summary strong').first().textContent()) === '10000', 'Worker must prepare all 10000 contacts');
    await page.getByRole('checkbox', {name:'I confirm the logged times are UTC'}).check();
    await page.getByRole('button', {name:'Validate & preview',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('[data-import-action="download"]')?.disabled === false);
    const largeDownload = page.waitForEvent('download');
    await page.getByRole('button', {name:'Download log',exact:true}).click();
    await (await largeDownload).saveAs('output/playwright/large.adif');
    // A number-field blur immediately followed by Preview must keep the edit.
    await page.getByRole('spinbutton', {name:'Header source line (0 = none)',exact:true}).fill('0');
    await page.getByRole('button', {name:'Validate & preview',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.import-summary strong')?.textContent === '10001');
    await page.locator('.import-result:not([hidden])').waitFor();
    assert(await page.getByRole('button', {name:'Download log',exact:true}).isDisabled(), 'Preview must validate the requested no-header interpretation');
    assert(await page.getByRole('spinbutton', {name:'Header source line (0 = none)',exact:true}).inputValue() === '0', 'Header edit was lost');

    // Native editor revisions must invalidate an already-open mapper.
    await page.locator('input[type=file]').first().setInputFiles('output/playwright/editor-source.adi');
    await page.getByRole('textbox', {name:'Log text',exact:true}).waitFor();
    await page.getByRole('button', {name:'Convert',exact:true}).click();
    await page.getByRole('button', {name:'Map fields and export',exact:true}).click();
    await page.getByRole('region', {name:'Advanced log import'}).waitFor();
    await page.getByRole('textbox', {name:'Contest name / identifier',exact:true}).fill('Audit');
    for (const undoButton of await page.getByRole('button', {name:'Undo',exact:true}).all()) assert(await undoButton.isEnabled(), 'First text edit must immediately enable Undo');
    await page.locator('.import-workspace').getByRole('button', {name:'Undo',exact:true}).click();
    await page.getByRole('button', {name:/^Contacts/}).click();
    await page.getByRole('textbox', {name:'CALL record 1',exact:true}).fill('S50C');
    await page.getByRole('textbox', {name:'CALL record 1',exact:true}).press('Tab');
    await page.getByRole('button', {name:'Convert',exact:true}).click();
    assert(await page.getByRole('region', {name:'Advanced log import'}).count() === 0, 'Structured edits must invalidate the old mapping session');
    await page.getByRole('button', {name:'Map fields and export',exact:true}).click();
    await page.getByRole('button', {name:'Validate & preview',exact:true}).click();
    const refreshed = await page.locator('.import-result pre').textContent();
    assert(refreshed.includes('<CALL:4>S50C') && !refreshed.includes('<CALL:4>S53O'), 'Mapper export must use the current editor revision');
    assert(errors.length === 0, errors.join(' | '));
    console.log('BROWSER_CHECKS_PASSED: production upload, paste, metadata, EDI download, correction, undo/redo, ADIF/ADX/CSV, 5 viewports, 10000-contact offline worker, no runtime errors');
  }`;
  const output = cli('run-code', code);
  if (!output.includes('BROWSER_CHECKS_PASSED')) throw new Error(output);
  const edi = await readFile('output/playwright/s53zo.edi', 'utf8');
  if (!edi.includes('CQSOP=3877') || edi.split(/\r?\n/).filter(line => line.startsWith('260906;')).length !== 28) throw new Error('Downloaded EDI failed fixture checks');
  const report = JSON.parse(await readFile('output/playwright/conversion.json', 'utf8'));
  if (!report.source.includes('???') || report.canonical.records[0].values.CALL !== 'S53O') throw new Error('Downloaded report lost correction provenance');
  const large = await readFile('output/playwright/large.adif', 'utf8');
  if ((large.match(/<EOR>/g) ?? []).length !== 10000) throw new Error('Worker export lost contacts');
  console.log('Browser checks passed; screenshots and actual downloads are in output/playwright/.');
} finally {
  try { cli('close'); } catch { /* Preserve original test failure. */ }
  if (server.pid && process.platform !== 'win32') { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* Already exited. */ } }
  else server.kill();
}
