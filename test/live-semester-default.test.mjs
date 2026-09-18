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

async function startupBlock() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf("document.addEventListener('DOMContentLoaded', async () => {");
  assert.notEqual(start, -1);
  return { html, startup: html.slice(start, html.indexOf('});', start)) };
}

// While the Scheduler is not fully in production, the reviewed WhenIWork
// snapshots are more accurate than the live pull, so startup opens on the
// newest saved snapshot and only falls back to live data when none exists.
test('startup opens on the newest saved snapshot before considering live data', async () => {
  const { startup } = await startupBlock();
  assert.match(startup, /const semester = await prefillPeriodsFromSemester\(\)/);
  assert.match(startup, /if \(await loadLatestAnalyzerSnapshot\(\)\) \{[\s\S]*\} else if \(skipLiveAutoload\(\)\) \{[\s\S]*\} else if \(semester && semester\.pending\)[\s\S]*else \{\s*await loadLiveData\(\);/);
});

test('chooses the snapshot covering the latest date, then the newest save', async () => {
  const { html } = await startupBlock();
  const sortValue = Function(`return (${extractFunction(html, 'analyzerSnapshotSortValue')})`)();
  const latest = Function(
    'analyzerSnapshotSortValue',
    '_snapshots',
    `return (${extractFunction(html, 'latestAnalyzerSnapshot')})();`
  );
  assert.equal(latest(sortValue, [
    { name: 'FA26-9.13.json', meta: { dateTo: '2026-09-13', savedAt: '2026-09-14T12:00:00Z' } },
    { name: 'FA26-9.06.json', meta: { dateTo: '2026-09-06', savedAt: '2026-09-17T12:00:00Z' } },
  ]).name, 'FA26-9.13.json');
  assert.equal(latest(sortValue, [
    { name: 'FA26-9.13.json', meta: { dateTo: '2026-09-13', savedAt: '2026-09-14T12:00:00Z' } },
    { name: 'FA26-9.13 corrected.json', meta: { dateTo: '2026-09-13', savedAt: '2026-09-16T12:00:00Z' } },
  ]).name, 'FA26-9.13 corrected.json');
  assert.equal(latest(sortValue, []), null);
});

test('the skip-live-autoload preference bypasses the live pull but not the semester gate', async () => {
  const { html, startup } = await startupBlock();
  assert.match(startup, /restoreSkipLiveAutoload\(\)/);
  assert.match(html, /id="skip-live-autoload"[^>]*onchange="setSkipLiveAutoload\(this\.checked\)"/);
  assert.match(html, /analyzerStorageKey\('skipLiveAutoload'\)/);
});
