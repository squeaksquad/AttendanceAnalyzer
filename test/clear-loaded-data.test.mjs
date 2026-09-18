import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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

// Minimal DOM stand-in: every id resolves to an element that records what was
// done to it, and querySelectorAll hands back a few fake zones/inputs.
function fakeDom() {
  const els = new Map();
  const mk = () => ({
    value: 'x', textContent: 'x', innerHTML: 'x', disabled: false, className: 'zone-status ok',
    style: {}, classes: new Set(['loaded', 'error']),
    classList: { remove(...c) { c.forEach(x => this._s.delete(x)); }, add(c) { this._s.add(c); }, _s: null },
  });
  const get = id => { if (!els.has(id)) { const e = mk(); e.classList._s = e.classes; els.set(id, e); } return els.get(id); };
  const zones = ['z1', 'z2'].map(get), statuses = ['s1', 's2'].map(get), inputs = ['i1', 'i2'].map(get);
  return {
    els, get,
    document: {
      getElementById: get,
      querySelectorAll: sel => sel === '.upload-zone' ? zones : sel === '.zone-status' ? statuses : inputs,
    },
  };
}

test('clearLoadedData unloads live/uploaded data but keeps synced department edits', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dom = fakeDom();
  const calls = [];
  const state = {
    absences: [1], clockin: [1], shifts: [1], timesheets: [1], absences2: [1], clockin2: [1], shifts2: [1], timesheets2: [1],
    users: [1], userMap: { a: 1 }, emailMap: { a: 'x' },
    results: [1], detailMap: { a: 1 }, prepCloseData: [1], _lastBuilt: { rawShifts: [1] }, shiftFilter: { a: 1 },
    overrides: new Set(['k']), omissions: new Set(['k']), autocorrections: new Set(['k']),
    inferredClosures: new Set(['2026-01-01']), closuresDirty: true,
    manualClosures: new Set(['2026-02-02']), penaltyFreeDays: new Set(['2026-03-03']), excused: [{ name: 'A' }],
    att: { openRows: new Set(['r']) }, pc: { openRows: new Set(['r']) },
  };
  const ctx = {
    state, document: dom.document,
    updateCorrectionCount: () => calls.push('updateCorrectionCount'),
    updateDateRangePill: v => calls.push('updateDateRangePill:' + v),
    renderClosuresSidebar: () => calls.push('renderClosuresSidebar'),
    onDateFilterChange: () => calls.push('onDateFilterChange'),
    setPeriodMsg: t => calls.push('setPeriodMsg:' + t),
    liveMsg: t => calls.push('liveMsg:' + t),
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(html, 'clearLoadedData') + '\nclearLoadedData();', ctx);

  for (const k of ['absences','clockin','shifts','timesheets','absences2','clockin2','shifts2','timesheets2','users','userMap','emailMap','results','prepCloseData','_lastBuilt'])
    assert.equal(state[k], null, k + ' cleared');
  assert.equal(Object.keys(state.detailMap).length, 0);
  assert.equal(Object.keys(state.shiftFilter).length, 0);
  for (const k of ['overrides','omissions','autocorrections','inferredClosures'])
    assert.equal(state[k].size, 0, k + ' emptied');
  assert.equal(state.closuresDirty, false);
  assert.equal(state.att.openRows.size, 0);
  assert.equal(state.pc.openRows.size, 0);

  // Server-synced department edits survive a clear
  assert.deepEqual([...state.manualClosures], ['2026-02-02']);
  assert.deepEqual([...state.penaltyFreeDays], ['2026-03-03']);
  assert.deepEqual(state.excused, [{ name: 'A' }]);

  for (const id of ['run-btn','export-btn','snapshot-btn','correct-btn','worker-pdf-btn','bulk-pdf-btn','github-push-btn'])
    assert.equal(dom.get(id).disabled, true, id + ' disabled');
  assert.equal(dom.get('filter-date-from').value, '');
  assert.equal(dom.get('filter-date-to').value, '');
  assert.equal(dom.get('folder-status').textContent, '');
  assert.equal(dom.get('folder-btn2').classes.has('loaded'), false);
  assert.match(dom.get('main').innerHTML, /empty-state/);
  for (const z of dom.document.querySelectorAll('.upload-zone')) assert.equal(z.classes.has('loaded'), false);
  for (const s of dom.document.querySelectorAll('.zone-status')) assert.equal(s.className, 'zone-status');

  assert.ok(calls.includes('updateDateRangePill:null'));
  assert.ok(calls.includes('onDateFilterChange'));
  assert.ok(calls.includes('renderClosuresSidebar'));
  assert.ok(calls.some(c => c.startsWith('liveMsg:')));
});

test('the sidebar exposes a Clear Loaded Data button for editors', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="clear-data-btn"[^>]*onclick="clearLoadedData\(\)"/);
  assert.match(html, /class="export-btn attendance-edit-only" id="clear-data-btn"/);
});
