import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadParser() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const marker = 'function parseClockinPeriods(';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, 'parseClockinPeriods must exist in index.html');

  const openBrace = html.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}') depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
  assert.notEqual(end, -1, 'parseClockinPeriods must have balanced braces');
  return Function(`return (${html.slice(start, end)})`)();
}

test('does not carry the previous workbook assignee into leading open shifts', async () => {
  const parseClockinPeriods = await loadParser();
  const normalize = name => String(name).replace(/^([^,]+),\s*(.+)$/, '$2 $1');

  const period1 = [
    {'Assignee Name':'Xia, Linda Yiling'},
    {'Has Timeclock Entry':'true'},
    {'Start Date':'2026-07-04', 'Start Time':'16:00', 'End Time':'20:00'}
  ];
  const period2 = [
    {'Has Timeclock Entry':'false'},
    {'Start Date':'2026-07-06', 'Start Time':'11:00', 'End Time':'13:00'},
    {'Start Date':'2026-07-06', 'Start Time':'20:00', 'End Time':'00:00'},
    {'Assignee Name':'Angarny, Jazz'},
    {'Has Timeclock Entry':'true'},
    {'Start Date':'2026-07-07', 'Start Time':'11:00', 'End Time':'13:00'}
  ];

  const parsed = parseClockinPeriods([period1, period2], normalize);

  assert.deepEqual(parsed.assignees, ['Linda Yiling Xia', 'Jazz Angarny']);
  assert.deepEqual(parsed.shifts.map(shift => shift.name), [
    'Linda Yiling Xia',
    'Jazz Angarny'
  ]);
  assert.deepEqual(parsed.shifts.map(shift => shift.hasClock), [true, true]);
  assert.equal(parsed.shifts.some(shift => shift.row['Start Date'] === '2026-07-06'), false);
});

test('skips a leading open group even in the first workbook', async () => {
  const parseClockinPeriods = await loadParser();
  const rows = [
    {'Has Timeclock Entry':'false'},
    {'Start Date':'2026-07-06', 'Start Time':'11:00', 'End Time':'13:00'},
    {'Assignee Name':'Xia, Linda Yiling'},
    {'Has Timeclock Entry':'false'},
    {'Start Date':'2026-07-11', 'Start Time':'16:00', 'End Time':'20:00'}
  ];

  const parsed = parseClockinPeriods([rows], value => String(value));

  assert.deepEqual(parsed.assignees, ['Xia, Linda Yiling']);
  assert.equal(parsed.shifts.length, 1);
  assert.equal(parsed.shifts[0].name, 'Xia, Linda Yiling');
  assert.equal(parsed.shifts[0].row['Start Date'], '2026-07-11');
  assert.equal(parsed.shifts[0].hasClock, false);
});
