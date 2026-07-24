import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function extractFunction(html, name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist in index.html`);
  const openBrace = html.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}') depth--;
    if (depth === 0) return html.slice(start, i + 1);
  }
  assert.fail(`${name} must have balanced braces`);
}

test('chooses the snapshot with the latest covered date', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const sortValue = Function(`return (${extractFunction(html, 'analyzerSnapshotSortValue')})`)();
  const latest = Function(
    'analyzerSnapshotSortValue',
    '_snapshots',
    `return (${extractFunction(html, 'latestAnalyzerSnapshot')})();`
  );
  const snapshots = [
    { name: 'SU26-7.19.json', meta: { dateTo: '2026-07-19', savedAt: '2026-07-20T12:00:00Z' } },
    { name: 'SU26-7.12.json', meta: { dateTo: '2026-07-12', savedAt: '2026-07-23T12:00:00Z' } },
  ];

  assert.equal(latest(sortValue, snapshots).name, 'SU26-7.19.json');
  assert.match(html, /SUMMER_SNAPSHOT_DEFAULT_THROUGH\s*=\s*'2026-09-02'/);
});
