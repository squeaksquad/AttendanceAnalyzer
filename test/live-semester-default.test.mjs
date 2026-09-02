import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Startup must open on the active semester's live data. The summer-2026
// "newest reviewed snapshot" default was a dated exception; once Fall started,
// it kept opening the Analyzer on the Summer snapshot.
test('startup pulls live data for the active semester instead of a saved snapshot', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf("document.addEventListener('DOMContentLoaded', async () => {");
  assert.notEqual(start, -1);
  const startup = html.slice(start, html.indexOf('});', start));

  assert.match(startup, /const semester = await prefillPeriodsFromSemester\(\)/);
  assert.match(startup, /await loadLiveData\(\)/);
  assert.doesNotMatch(startup, /Snapshot\(/);
  assert.doesNotMatch(html, /SUMMER_SNAPSHOT_DEFAULT_THROUGH|shouldAutoLoadLatestSnapshot|loadLatestAnalyzerSnapshot/);
});

test('a semester with no complete day yet skips the live pull instead of erroring', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf("document.addEventListener('DOMContentLoaded', async () => {");
  const startup = html.slice(start, html.indexOf('});', start));
  assert.match(startup, /if \(semester && semester\.pending\)[\s\S]*else \{\s*await loadLiveData\(\);/);
});
