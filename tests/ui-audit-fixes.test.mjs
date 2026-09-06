import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportController } from '../src/ui/import-controller.ts';
import { dispatchImportTask, IMPORT_WORKER_THRESHOLD } from '../src/core/import-tasks.ts';
import { renderImportWorkspace } from '../src/ui/import-view.ts';

const fixture = 'Date,Time,Call,Mode,Freq\n20260906,1238,S53O,SSB,144.3';
const flush = () => new Promise(resolve => setImmediate(resolve));

function environment(t) {
  const original = Object.fromEntries(['document', 'HTMLInputElement', 'Worker', 'localStorage'].map(key => [key, globalThis[key]]));
  const jobs = [];
  const buttons = { undo: [{disabled:true}, {disabled:true}], redo: [{disabled:true}, {disabled:true}] };
  const nodes = new Map();
  const fieldsets = [{disabled:false}, {disabled:false}, {disabled:false}];
  let pointerActive = false;
  globalThis.document = {
    querySelector: selector => selector === 'button:active' ? pointerActive : null,
    querySelectorAll: selector => selector === '[data-import-structure-controls]' ? fieldsets : buttons[selector.includes('undo') ? 'undo' : 'redo'],
    getElementById: id => nodes.get(id) ?? null,
  };
  globalThis.localStorage = {getItem: () => '[]'};
  globalThis.HTMLInputElement = class {
    constructor(field, value, type = 'text', extra = {}) { this.dataset = {importField:field,...extra}; this.value = value; this.type = type; this.checked = false; }
  };
  globalThis.Worker = class {
    constructor() { jobs.push(this); }
    postMessage(task) { this.task = task; }
    terminate() { this.terminated = true; }
  };
  t.after(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  return {jobs, buttons, nodes, fieldsets, pointer: active => { pointerActive = active; }};
}

function controller(t, large = true) {
  const prepared = dispatchImportTask({kind:'prepare',source:fixture});
  const source = large ? fixture + '\n20260906,1238,S53O,SSB,144.3'.repeat(Math.ceil(IMPORT_WORKER_THRESHOLD / 28) + 1) : fixture;
  const session = {...prepared.session, source};
  let renders = 0;
  const control = new ImportController(session, () => renders++, () => {}, () => {}, prepared.normalized);
  t.after(() => control.dispose());
  return {control, renders: () => renders};
}

async function finish(job) {
  job.onmessage({data:{result:dispatchImportTask(job.task)}});
  await flush();
}

test('numeric header blur finishes before preview and refreshes the corrected interpretation', async t => {
  const {jobs} = environment(t);
  const {control, renders} = controller(t);
  control.change(new HTMLInputElement('headerRow', '0', 'number'));
  control.click({dataset:{importAction:'preview'}});
  assert.equal(jobs.length, 1, 'preview waits for the structural edit');
  assert.equal(jobs[0].terminated, undefined);
  await finish(jobs[0]);
  assert.equal(control.workspace.session.options.headerRow, null);
  assert.equal(jobs[1].task.operation, 'preview');
  assert.equal(jobs[1].task.state.session.options.headerRow, null);
  assert.ok(renders() > 0, 'numeric structural edits refresh displayed mappings');
  await finish(jobs[1]);
  assert.ok(control.workspace.result);
});

test('boundary edit finishes before navigation and supports undo', async t => {
  const {jobs} = environment(t);
  const {control} = controller(t);
  control.change(new HTMLInputElement('boundary', '8', 'number', {importIndex:'0'}));
  control.click({dataset:{importAction:'page-next'}});
  assert.equal(jobs.length, 1);
  await finish(jobs[0]);
  assert.equal(control.workspace.session.options.strategy, 'fixed-width');
  assert.ok(control.workspace.session.options.boundaries.includes(8));
  assert.equal(control.workspace.page, 1);
  await finish(jobs[1]);
  control.undo();
  assert.equal(control.workspace.session.options.strategy, undefined);
});

test('schema-independent metadata changes wait for structure before preview', async t => {
  const {jobs} = environment(t);
  const {control} = controller(t);
  control.change(new HTMLInputElement('headerRow', '0', 'number'));
  control.change(new HTMLInputElement('metadata', 'S53ZO', 'text', {importValue:'stationCall'}));
  control.click({dataset:{importAction:'preview'}});
  await finish(jobs[0]);
  assert.equal(jobs[1].task.operation, 'preview');
  assert.equal(jobs[1].task.state.session.options.headerRow, null);
  assert.equal(jobs[1].task.state.metadata.stationCall, 'S53ZO');
});

test('structural jobs reject stale column mappings, cells and index actions', async t => {
  const env = environment(t);
  const source = 'Exchange,Call,Date,Time,Freq,Mode\n' + '001 JN86CR,S53O,20260906,1200,144.3,SSB\n'.repeat(3000);
  const prepared = dispatchImportTask({kind:'prepare',source});
  const control = new ImportController(prepared.session, () => {}, () => {}, () => {}, prepared.normalized);
  t.after(() => control.dispose());
  env.nodes.set('import-split-0', new HTMLInputElement('', ' '));
  control.click({dataset:{importAction:'split',importIndex:'0'}});
  assert.ok(env.fieldsets.every(fieldset => fieldset.disabled));
  control.change(new HTMLInputElement('mapping', 'OPERATOR', 'text', {importIndex:'1'}));
  control.input(new HTMLInputElement('cell', 'BAD', 'text', {importIndex:'1', importValue:'1'}));
  control.change(new HTMLInputElement('constant', 'BAD', 'text', {importIndex:'1'}));
  control.click({dataset:{importAction:'boundary-delete',importIndex:'1'}});
  control.click({dataset:{importAction:'split',importIndex:'1'}});
  assert.equal(env.jobs.length, 1);
  const pendingHtml = control.render();
  assert.equal((pendingHtml.match(/data-import-structure-controls disabled/g) ?? []).length, 3);
  control.click({dataset:{importAction:'preview'}});
  await finish(env.jobs[0]);
  assert.equal(env.jobs.length, 2);
  assert.equal(env.jobs[1].task.operation, 'preview');
  assert.equal(control.workspace.session.columns[1].field, '');
  assert.equal(control.workspace.session.columns[2].field, 'CALL');
  assert.deepEqual(control.workspace.session.rows[1].cells.slice(0, 3), ['001', 'JN86CR', 'S53O']);
  // Keep rejecting old indexes until replacement controls have been rendered.
  control.change(new HTMLInputElement('mapping', 'OPERATOR', 'text', {importIndex:'1'}));
  assert.equal(control.workspace.session.columns[1].field, '');
  await finish(env.jobs[1]);
  const currentHtml = control.render();
  assert.equal((currentHtml.match(/data-import-structure-controls disabled/g) ?? []).length, 0);
  control.change(new HTMLInputElement('mapping', 'OPERATOR', 'text', {importIndex:'2'}));
  assert.equal(control.workspace.session.columns[2].field, 'OPERATOR');
});

test('failed structural updates re-enable the unchanged schema controls', async t => {
  const env = environment(t);
  const {control} = controller(t);
  control.change(new HTMLInputElement('headerRow', '0', 'number'));
  assert.ok(env.fieldsets.every(fieldset => fieldset.disabled));
  env.jobs[0].onmessage({data:{error:'Invalid structure'}});
  await flush();
  assert.ok(env.fieldsets.every(fieldset => !fieldset.disabled));
  assert.doesNotMatch(control.render(), /data-import-structure-controls disabled/);
});

test('failed or disposed structural jobs never execute a queued preview', async t => {
  const {jobs} = environment(t);
  const {control} = controller(t);
  control.change(new HTMLInputElement('headerRow', '0', 'number'));
  control.click({dataset:{importAction:'preview'}});
  jobs[0].onmessage({data:{error:'Invalid structure'}});
  await flush();
  assert.equal(jobs.length, 1);
  assert.match(control.workspace.notice, /Invalid structure/);
  control.change(new HTMLInputElement('headerRow', '0', 'number'));
  control.click({dataset:{importAction:'preview'}});
  control.dispose();
  await flush();
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].terminated, true);
});

test('structural refresh waits until a pressed button has received its click', async t => {
  const env = environment(t);
  const {control, renders} = controller(t);
  control.change(new HTMLInputElement('headerRow', '0', 'number'));
  env.pointer(true);
  await finish(env.jobs[0]);
  assert.equal(renders(), 0);
  control.click({dataset:{importAction:'preview'}});
  env.pointer(false);
  await finish(env.jobs[1]);
  assert.ok(renders() > 0);
});

for (const large of [false, true]) test(`text edits immediately update both history buttons and remain coalesced (${large ? 'large' : 'small'})`, t => {
  const {buttons} = environment(t);
  const {control} = controller(t, large);
  const element = new HTMLInputElement('metadata', 'S', 'text', {importValue:'stationCall'});
  control.input(element);
  assert.ok(buttons.undo.every(button => !button.disabled));
  element.value = 'S53ZO';
  control.input(element);
  control.change(element);
  assert.equal(control.workspace.undoStack.length, 1);
  control.workspace.undo();
  buttons.redo.forEach(button => { button.disabled = false; });
  control.input(new HTMLInputElement('metadata', 'S50C', 'text', {importValue:'stationCall'}));
  assert.ok(buttons.redo.every(button => button.disabled));
  assert.equal(control.workspace.redoStack.length, 0);
});

test('destination loss rendering is bounded while the full report stays intact', () => {
  const {session, normalized} = dispatchImportTask({kind:'prepare',source:fixture});
  const losses = Array.from({length:50000}, (_, i) => `Row ${i + 1}: frequency retained in report`);
  const result = {canExport:true, content:'preview', diagnostics:[], lossReport:losses, report:{losses}};
  const html = renderImportWorkspace({session, normalized, target:'cabrillo', metadata:{}, page:0, canUndo:false, canRedo:false, notice:'', presets:[], result});
  assert.equal((html.match(/<li>/g) ?? []).length, 100);
  assert.match(html, /Showing the first 100 destination limitations/);
  assert.match(html, /Destination limitations · 50000/);
  assert.equal(JSON.parse(JSON.stringify(result.report)).losses.length, 50000);
});
