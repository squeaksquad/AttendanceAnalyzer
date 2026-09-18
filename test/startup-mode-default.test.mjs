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

// What the Analyzer opens on is a department-wide server-side setting
// ('manual' = newest saved snapshot, 'live' = active semester's live pull),
// not a per-browser preference. The old localStorage skip toggle is gone.
test('startup branches on the department startup mode: live pull vs newest snapshot', async () => {
  const { html, startup } = await startupBlock();
  assert.match(startup, /const semester = await prefillPeriodsFromSemester\(\)/);
  assert.match(startup, /if \(analyzerStartupMode\(\) === 'live'\) \{[\s\S]*if \(semester && semester\.pending\)[\s\S]*else \{\s*await loadLiveData\(\);[\s\S]*\} else if \(!\(await loadLatestAnalyzerSnapshot\(\)\)\)/);
  assert.doesNotMatch(html, /skipLiveAutoload|skip-live-autoload/);
});

test('the startup mode comes from the /context settings and defaults to manual', async () => {
  const { html } = await startupBlock();
  const normalize = Function(`const STARTUP_MODES = ['manual', 'live']; return (${extractFunction(html, 'normalizeStartupMode')})`)();
  assert.equal(normalize('live'), 'live');
  assert.equal(normalize('manual'), 'manual');
  assert.equal(normalize(undefined), 'manual');
  assert.equal(normalize('sometimes'), 'manual');
  assert.match(html, /startupMode: normalizeStartupMode\(context\.settings && context\.settings\.startupMode\)/);
});

test('changing the mode asks for confirmation and saves department-wide through PUT /settings', async () => {
  const { html } = await startupBlock();
  assert.match(html, /STARTUP_MODE_CONFIRM = 'Are you sure\? This will change the default behavior for everyone\.'/);
  const fn = extractFunction(html, 'requestStartupModeChange');
  assert.match(fn, /if \(!confirm\(STARTUP_MODE_CONFIRM\)\) return false;/);
  assert.match(fn, /analyzerApiCall\('PUT', '\/settings', \{ startupMode: mode \}\)/);
  // The confirm must come before the network call.
  assert.ok(fn.indexOf('confirm(STARTUP_MODE_CONFIRM)') < fn.indexOf("analyzerApiCall('PUT'"));
  assert.match(html, /data-startup-mode="manual" onclick="requestStartupModeChange\('manual'\)"/);
  assert.match(html, /data-startup-mode="live" onclick="requestStartupModeChange\('live'\)"/);
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
