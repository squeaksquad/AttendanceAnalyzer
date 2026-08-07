import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const BEGIN = '// ── Analyzer dual-client authentication BEGIN';
const END = '// ── Analyzer dual-client authentication END';

async function loadAuthModule() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf(BEGIN);
  const end = html.indexOf(END);
  assert.notEqual(start, -1, 'dual-client auth BEGIN marker must exist in index.html');
  assert.notEqual(end, -1, 'dual-client auth END marker must exist in index.html');
  const source = html.slice(start, end);
  const names = [
    'parseAnalyzerHandoffFragment',
    'isValidAnalyzerAssertionPayload',
    'isValidAnalyzerRenewalPayload',
    'isValidAnalyzerAuthReply',
    'analyzerBearerRequestInit',
    'isAnalyzerAssertionUsable',
    'isAnalyzerRenewalUsable',
    'analyzerAuthNonce',
  ];
  const wrapped = `${source}\nreturn { ${names.join(', ')} };`;
  return Function(wrapped)();
}

const VALID_OPAQUE = 'a'.repeat(43);
const VALID_ASSERTION = `${'a'.repeat(20)}.${'b'.repeat(20)}`;

test('parseAnalyzerHandoffFragment accepts an exact handoff fragment', async () => {
  const { parseAnalyzerHandoffFragment: parse } = await loadAuthModule();
  assert.equal(parse(`#handoff=${VALID_OPAQUE}`), VALID_OPAQUE);
});

test('parseAnalyzerHandoffFragment accepts a percent-encoded opaque value', async () => {
  const { parseAnalyzerHandoffFragment: parse } = await loadAuthModule();
  const encoded = encodeURIComponent(VALID_OPAQUE);
  assert.equal(parse(`#handoff=${encoded}`), VALID_OPAQUE);
});

test('parseAnalyzerHandoffFragment rejects malformed fragments', async () => {
  const { parseAnalyzerHandoffFragment: parse } = await loadAuthModule();
  assert.equal(parse(''), null);
  assert.equal(parse('#'), null);
  assert.equal(parse('#handoff='), null);
  assert.equal(parse('#handoff=tooshort'), null);
  assert.equal(parse(`#handoff=${VALID_OPAQUE}extra`), null);
  assert.equal(parse(`#handoff=${'!'.repeat(43)}`), null);
  assert.equal(parse(`#other=${VALID_OPAQUE}`), null);
  assert.equal(parse('#handoff=%'), null); // decodeURIComponent throws
  assert.equal(parse(null), null);
  assert.equal(parse(undefined), null);
});

test('isValidAnalyzerAssertionPayload accepts a well-formed payload', async () => {
  const { isValidAnalyzerAssertionPayload: isValid } = await loadAuthModule();
  assert.equal(isValid({ assertion: VALID_ASSERTION, expires_at: Date.now() + 1000, department_id: 1 }), true);
});

test('isValidAnalyzerAssertionPayload rejects malformed payloads', async () => {
  const { isValidAnalyzerAssertionPayload: isValid } = await loadAuthModule();
  assert.equal(isValid(null), false);
  assert.equal(isValid({}), false);
  assert.equal(isValid({ assertion: 'no-dot', expires_at: 1, department_id: 1 }), false);
  assert.equal(isValid({ assertion: VALID_ASSERTION, expires_at: 'soon', department_id: 1 }), false);
  assert.equal(isValid({ assertion: VALID_ASSERTION, expires_at: 1, department_id: 0 }), false);
  assert.equal(isValid({ assertion: VALID_ASSERTION, expires_at: 1, department_id: 1.5 }), false);
  assert.equal(isValid({ assertion: 'a'.repeat(5000) + '.' + 'b', expires_at: 1, department_id: 1 }), false);
});

test('isValidAnalyzerRenewalPayload requires a valid opaque renewal and expiry', async () => {
  const { isValidAnalyzerRenewalPayload: isValid } = await loadAuthModule();
  const base = { assertion: VALID_ASSERTION, expires_at: 1, department_id: 1 };
  assert.equal(isValid({ ...base, renewal: VALID_OPAQUE, renewal_expires_at: 1 }), true);
  assert.equal(isValid({ ...base }), false);
  assert.equal(isValid({ ...base, renewal: 'short', renewal_expires_at: 1 }), false);
  assert.equal(isValid({ ...base, renewal: VALID_OPAQUE, renewal_expires_at: 'x' }), false);
});

test('isValidAnalyzerAuthReply enforces exact origin, source, and nonce', async () => {
  const { isValidAnalyzerAuthReply: isValid } = await loadAuthModule();
  const parentWindow = { id: 'parent' };
  const hostileWindow = { id: 'hostile' };
  const payload = { assertion: VALID_ASSERTION, expires_at: Date.now() + 1000, department_id: 1 };
  const goodEvent = {
    origin: 'https://berklee.bryandimaio.com',
    source: parentWindow,
    data: { type: 'analyzer-auth-response', nonce: 'n1', payload },
  };
  assert.equal(isValid(goodEvent, 'https://berklee.bryandimaio.com', parentWindow, 'n1'), true);

  // Hostile origin
  assert.equal(isValid(
    { ...goodEvent, origin: 'https://evil.example' },
    'https://berklee.bryandimaio.com', parentWindow, 'n1',
  ), false);

  // Hostile source (a different window object, e.g. a nested/sibling frame)
  assert.equal(isValid(
    { ...goodEvent, source: hostileWindow },
    'https://berklee.bryandimaio.com', parentWindow, 'n1',
  ), false);

  // Wrong nonce (replay of a stale reply)
  assert.equal(isValid(
    { ...goodEvent, data: { ...goodEvent.data, nonce: 'stale' } },
    'https://berklee.bryandimaio.com', parentWindow, 'n1',
  ), false);

  // Missing nonce on our side (handshake never started)
  assert.equal(isValid(goodEvent, 'https://berklee.bryandimaio.com', parentWindow, null), false);

  // Wrong message type
  assert.equal(isValid(
    { ...goodEvent, data: { ...goodEvent.data, type: 'something-else' } },
    'https://berklee.bryandimaio.com', parentWindow, 'n1',
  ), false);

  // Malformed payload
  assert.equal(isValid(
    { ...goodEvent, data: { ...goodEvent.data, payload: { assertion: 'bad' } } },
    'https://berklee.bryandimaio.com', parentWindow, 'n1',
  ), false);

  // No event at all
  assert.equal(isValid(null, 'https://berklee.bryandimaio.com', parentWindow, 'n1'), false);
});

test('analyzerBearerRequestInit sends the assertion and omits credentials', async () => {
  const { analyzerBearerRequestInit: buildInit } = await loadAuthModule();
  const init = buildInit('assertion-value', { method: 'GET', headers: { 'X-Sched-Department': '1' } });
  assert.equal(init.credentials, 'omit');
  assert.equal(init.headers.Authorization, 'Bearer assertion-value');
  assert.equal(init.headers['X-Sched-Department'], '1');
  assert.equal(init.method, 'GET');
});

test('isAnalyzerAssertionUsable and isAnalyzerRenewalUsable respect expiry boundaries', async () => {
  const { isAnalyzerAssertionUsable: assertionUsable, isAnalyzerRenewalUsable: renewalUsable } = await loadAuthModule();
  assert.equal(assertionUsable(null, 100), false);
  assert.equal(assertionUsable({ expiresAt: 200 }, 100), true);
  assert.equal(assertionUsable({ expiresAt: 100 }, 100), false); // exactly at expiry is not usable
  assert.equal(assertionUsable({ expiresAt: 50 }, 100), false);
  assert.equal(renewalUsable(null, 100), false);
  assert.equal(renewalUsable({ absoluteExpiresAt: 200 }, 100), true);
  assert.equal(renewalUsable({ absoluteExpiresAt: 100 }, 100), false);
});

test('analyzerAuthNonce produces distinct, URL-safe values', async () => {
  const { analyzerAuthNonce: nonce } = await loadAuthModule();
  const a = nonce();
  const b = nonce();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length >= 20);
});
