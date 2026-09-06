import { readdir, readFile } from 'node:fs/promises';
import ts from 'typescript';

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${path}/${entry.name}`) : `${path}/${entry.name}`))).flat();
}
const problems = [];
for (const file of [...await files('src'), 'public/sw.js'].filter(file => /\.(ts|css|js)$/.test(file))) {
  const source = await readFile(file, 'utf8');
  if (/^(?:<{7}|={7}|>{7})(?: |$)/m.test(source)) problems.push(`${file}: unresolved conflict marker`);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source)) problems.push(`${file}: unexpected control character`);
  if (!/\.(ts|js)$/.test(file)) continue;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    const call = ts.isCallExpression(node) || ts.isNewExpression(node);
    if (call) {
      const name = node.expression.getText(tree);
      if (['eval', 'Function', 'window.eval', 'globalThis.eval', 'document.write'].includes(name)) problems.push(`${file}: dynamic code / document execution is prohibited (${name})`);
      if (['setTimeout', 'setInterval', 'window.setTimeout', 'window.setInterval'].includes(name) && node.arguments?.[0] && ts.isStringLiteralLike(node.arguments[0])) problems.push(`${file}: string-based timer execution is prohibited`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log('Source lint and static safety checks passed (conflicts, controls, dynamic execution).');
