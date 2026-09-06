import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

test('offline installation caches worker URLs relative to the built application bundle', async () => {
  const handlers = {}, additions = [];
  const cache = {
    put: async () => {},
    addAll: async values => additions.push(...values),
    match: async () => new Response('new URL("import-worker-Ab12_cd.js", import.meta.url)'),
  };
  vm.runInNewContext(source, {
    self: {addEventListener: (event, listener) => {handlers[event] = listener;}, skipWaiting: () => {}, location:{href:'https://example.test/LogChecker/sw.js'}},
    caches:{open:async () => cache}, URL,
    fetch:async () => new Response('<script src="./assets/index-123.js"></script><link href="./assets/site.css">'),
  });
  let pending;
  handlers.install({waitUntil: value => {pending = value;}});
  await pending;
  assert.ok(additions.includes('https://example.test/LogChecker/assets/import-worker-Ab12_cd.js'));
  assert.ok(additions.includes('./assets/site.css'));
});

test('cache upgrade leaves unrelated applications caches intact', async () => {
  const handlers = {}, deleted = [];
  vm.runInNewContext(source, {
    self: {addEventListener: (event, listener) => {handlers[event] = listener;}, clients:{claim:() => {}}, location:{}},
    caches:{keys:async () => ['other-app-v1','contest-log-workbench-v1','contest-log-workbench-v2'], delete:async key => {deleted.push(key);}},
  });
  let pending;
  handlers.activate({waitUntil: value => {pending = value;}});
  await pending;
  assert.deepEqual(deleted, ['contest-log-workbench-v1']);
});
