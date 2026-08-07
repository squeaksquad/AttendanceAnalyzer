import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const BEGIN = '// ── Analyzer dual-client authentication BEGIN';
const END = '// ── Analyzer dual-client authentication END';

const VALID_OPAQUE_A = 'a'.repeat(43);
const VALID_OPAQUE_B = 'b'.repeat(43);
const VALID_ASSERTION_1 = `${'a'.repeat(20)}.${'1'.repeat(20)}`;
const VALID_ASSERTION_2 = `${'a'.repeat(20)}.${'2'.repeat(20)}`;
const ANALYZER_WORKER_URL = 'https://berklee.bryandimaio.com';

let authSource = null;
async function getAuthSource() {
  if (authSource) return authSource;
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf(BEGIN);
  const end = html.indexOf(END);
  assert.notEqual(start, -1, 'dual-client auth BEGIN marker must exist in index.html');
  assert.notEqual(end, -1, 'dual-client auth END marker must exist in index.html');
  authSource = html.slice(start, end) +
    `\n// ── ANALYZER_WORKER_URL is defined just above this block in index.html ──\n` +
    `const ANALYZER_WORKER_URL = ${JSON.stringify(ANALYZER_WORKER_URL)};\n` +
    `function analyzerWorkerReady() { return ANALYZER_WORKER_URL && !ANALYZER_WORKER_URL.includes('YOUR-SUBDOMAIN'); }\n`;
  return authSource;
}

function makeWindow() {
  const listeners = [];
  const win = {
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener(type, fn) {
      if (type !== 'message') return;
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    dispatchMessage(event) { listeners.slice().forEach((fn) => fn(event)); },
    listenerCount() { return listeners.length; },
  };
  return win;
}

/** Builds a fresh sandboxed copy of the dual-client auth module with fake
 * browser globals, so each test gets independent module-level auth state. */
async function createSandbox({ embedded = false, fetchImpl, hash = '', posted } = {}) {
  const source = await getAuthSource();
  const win = makeWindow();
  const parentWindow = embedded ? { postMessage: (data, origin) => posted && posted(data, origin) } : win;
  win.parent = parentWindow;

  const sandbox = {
    window: win,
    location: { hash, pathname: '/', search: '' },
    history: { calls: [], replaceState(...args) { this.calls.push(args); } },
    crypto: { getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = (i * 7 + 13) % 256; return arr; } },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    URL,
    fetch: (...args) => fetchImpl(...args),
    // Real timers, but unref'd so a scheduled renewal (minutes out) never
    // keeps the test process alive; tests assert on state, not on firing.
    setTimeout: (fn, delay) => { const t = setTimeout(fn, delay); if (t.unref) t.unref(); return t; },
    clearTimeout,
    console,
  };
  vm.createContext(sandbox);
  const exported = [
    'parseAnalyzerHandoffFragment', 'isValidAnalyzerAssertionPayload', 'isValidAnalyzerRenewalPayload',
    'isValidAnalyzerAuthReply', 'analyzerBearerRequestInit', 'isAnalyzerAssertionUsable',
    'isAnalyzerRenewalUsable', 'analyzerAuthNonce', 'isAnalyzerEmbedded', 'clearAnalyzerAssertionState',
    'applyAnalyzerAssertion', 'exchangeAnalyzerGrant', 'renewAnalyzerAssertion', 'tryAnalyzerHandoffExchange',
    'tryAnalyzerEmbeddedHandshake', 'establishAnalyzerAuth', 'analyzerRequestInit', 'analyzerAuthenticatedFetch',
  ];
  const script = new vm.Script(
    `${source}\nglobalThis.__exports = { ${exported.join(', ')}, get state() { ` +
    `return { assertion: analyzerAssertionState, renewal: analyzerRenewalState, mode: analyzerAuthMode }; } };`
  );
  script.runInContext(sandbox);
  return { sandbox, exports: sandbox.__exports, win };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

// ── tryAnalyzerHandoffExchange ───────────────────────────────────────────────

test('handoff exchange: success strips the fragment and enters assertion mode', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(200, {
      assertion: VALID_ASSERTION_1, expires_at: Date.now() + 300000, department_id: 7,
      renewal: VALID_OPAQUE_B, renewal_expires_at: Date.now() + 8 * 3600000,
    });
  };
  const { sandbox, exports } = await createSandbox({ hash: `#handoff=${VALID_OPAQUE_A}`, fetchImpl });
  const ok = await exports.tryAnalyzerHandoffExchange();
  assert.equal(ok, true);
  assert.equal(exports.state.mode, 'assertion');
  assert.equal(exports.state.assertion.token, VALID_ASSERTION_1);
  assert.equal(exports.state.assertion.departmentId, 7);
  assert.equal(exports.state.renewal.token, VALID_OPAQUE_B);
  // The fragment must be stripped before the exchange result is even known.
  assert.equal(sandbox.history.calls.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${ANALYZER_WORKER_URL}/analyzer/auth/exchange`);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.deepEqual(JSON.parse(calls[0].init.body), { code: VALID_OPAQUE_A });
});

test('handoff exchange: malformed fragment never calls fetch or touches history', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse(200, {}); };
  const { sandbox, exports } = await createSandbox({ hash: '#handoff=not-opaque', fetchImpl });
  const ok = await exports.tryAnalyzerHandoffExchange();
  assert.equal(ok, false);
  assert.equal(called, false);
  assert.equal(sandbox.history.calls.length, 0);
  assert.equal(exports.state.mode, 'cookie');
});

test('handoff exchange: server rejection still strips the one-time code and falls back to cookie mode', async () => {
  const fetchImpl = async () => jsonResponse(401, { error: 'invalid_analyzer_grant' });
  const { sandbox, exports } = await createSandbox({ hash: `#handoff=${VALID_OPAQUE_A}`, fetchImpl });
  const ok = await exports.tryAnalyzerHandoffExchange();
  assert.equal(ok, false);
  assert.equal(exports.state.mode, 'cookie');
  assert.equal(sandbox.history.calls.length, 1); // stripped regardless of outcome
});

test('handoff exchange: network failure is caught and falls back to cookie mode', async () => {
  const fetchImpl = async () => { throw new TypeError('network down'); };
  const { exports } = await createSandbox({ hash: `#handoff=${VALID_OPAQUE_A}`, fetchImpl });
  const ok = await exports.tryAnalyzerHandoffExchange();
  assert.equal(ok, false);
  assert.equal(exports.state.mode, 'cookie');
});

test('handoff exchange: a reload with no fragment (code already consumed) does nothing', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse(200, {}); };
  const { exports } = await createSandbox({ hash: '', fetchImpl });
  const ok = await exports.tryAnalyzerHandoffExchange();
  assert.equal(ok, false);
  assert.equal(called, false);
});

// ── tryAnalyzerEmbeddedHandshake ─────────────────────────────────────────────

test('embedded handshake: accepts a valid reply from the exact parent origin/source/nonce', async () => {
  let capturedNonce = null;
  const posted = (data) => { capturedNonce = data.nonce; };
  const { exports, win } = await createSandbox({ embedded: true, posted, fetchImpl: async () => jsonResponse(500, {}) });
  const resultPromise = exports.tryAnalyzerEmbeddedHandshake(500);
  await new Promise((r) => setTimeout(r, 5));
  win.dispatchMessage({
    origin: ANALYZER_WORKER_URL,
    source: win.parent,
    data: {
      type: 'analyzer-auth-response',
      nonce: capturedNonce,
      payload: { assertion: VALID_ASSERTION_1, expires_at: Date.now() + 300000, department_id: 3 },
    },
  });
  const ok = await resultPromise;
  assert.equal(ok, true);
  assert.equal(exports.state.mode, 'assertion');
  assert.equal(exports.state.assertion.departmentId, 3);
});

test('embedded handshake: ignores a reply from a hostile origin and times out', async () => {
  let capturedNonce = null;
  const posted = (data) => { capturedNonce = data.nonce; };
  const { exports, win } = await createSandbox({ embedded: true, posted, fetchImpl: async () => jsonResponse(500, {}) });
  const resultPromise = exports.tryAnalyzerEmbeddedHandshake(30);
  await new Promise((r) => setTimeout(r, 5));
  win.dispatchMessage({
    origin: 'https://evil.example',
    source: win.parent,
    data: { type: 'analyzer-auth-response', nonce: capturedNonce, payload: { assertion: VALID_ASSERTION_1, expires_at: Date.now() + 300000, department_id: 3 } },
  });
  const ok = await resultPromise;
  assert.equal(ok, false);
  assert.equal(exports.state.mode, 'cookie');
});

test('embedded handshake: ignores a reply from a hostile source window and times out', async () => {
  let capturedNonce = null;
  const posted = (data) => { capturedNonce = data.nonce; };
  const { exports, win } = await createSandbox({ embedded: true, posted, fetchImpl: async () => jsonResponse(500, {}) });
  const resultPromise = exports.tryAnalyzerEmbeddedHandshake(30);
  await new Promise((r) => setTimeout(r, 5));
  win.dispatchMessage({
    origin: ANALYZER_WORKER_URL,
    source: { impersonating: 'parent' }, // not === win.parent
    data: { type: 'analyzer-auth-response', nonce: capturedNonce, payload: { assertion: VALID_ASSERTION_1, expires_at: Date.now() + 300000, department_id: 3 } },
  });
  const ok = await resultPromise;
  assert.equal(ok, false);
  assert.equal(exports.state.mode, 'cookie');
});

test('embedded handshake: ignores a reply with a mismatched (replayed/stale) nonce and times out', async () => {
  const posted = () => {};
  const { exports, win } = await createSandbox({ embedded: true, posted, fetchImpl: async () => jsonResponse(500, {}) });
  const resultPromise = exports.tryAnalyzerEmbeddedHandshake(30);
  await new Promise((r) => setTimeout(r, 5));
  win.dispatchMessage({
    origin: ANALYZER_WORKER_URL,
    source: win.parent,
    data: { type: 'analyzer-auth-response', nonce: 'stale-nonce-from-a-previous-load', payload: { assertion: VALID_ASSERTION_1, expires_at: Date.now() + 300000, department_id: 3 } },
  });
  const ok = await resultPromise;
  assert.equal(ok, false);
  assert.equal(exports.state.mode, 'cookie');
});

test('embedded handshake: not embedded (top-level window) resolves false without posting', async () => {
  let posted = false;
  const { exports } = await createSandbox({ embedded: false, posted: () => { posted = true; }, fetchImpl: async () => jsonResponse(500, {}) });
  const ok = await exports.tryAnalyzerEmbeddedHandshake(30);
  assert.equal(ok, false);
  assert.equal(posted, false);
});

// ── renewAnalyzerAssertion ───────────────────────────────────────────────────

test('renewal: success rotates to a new assertion and renewal token', async () => {
  const { exports } = await createSandbox({
    fetchImpl: async () => jsonResponse(200, {
      assertion: VALID_ASSERTION_2, expires_at: Date.now() + 300000, department_id: 5,
      renewal: VALID_OPAQUE_B, renewal_expires_at: Date.now() + 3600000,
    }),
  });
  exports.applyAnalyzerAssertion({
    assertion: VALID_ASSERTION_1, expires_at: Date.now() + 1000, department_id: 5,
    renewal: VALID_OPAQUE_A, renewal_expires_at: Date.now() + 3600000,
  });
  await exports.renewAnalyzerAssertion();
  assert.equal(exports.state.mode, 'assertion');
  assert.equal(exports.state.assertion.token, VALID_ASSERTION_2);
  assert.equal(exports.state.renewal.token, VALID_OPAQUE_B);
});

test('renewal: server rejection (expired/replayed grant) falls back to cookie mode', async () => {
  const { exports } = await createSandbox({ fetchImpl: async () => jsonResponse(401, { error: 'invalid_analyzer_grant' }) });
  exports.applyAnalyzerAssertion({
    assertion: VALID_ASSERTION_1, expires_at: Date.now() + 1000, department_id: 5,
    renewal: VALID_OPAQUE_A, renewal_expires_at: Date.now() + 3600000,
  });
  await exports.renewAnalyzerAssertion();
  assert.equal(exports.state.mode, 'cookie');
  assert.equal(exports.state.assertion, null);
  assert.equal(exports.state.renewal, null);
});

test('renewal: past the 8-hour absolute expiry, no request is made and state is cleared', async () => {
  let called = false;
  const { exports } = await createSandbox({ fetchImpl: async () => { called = true; return jsonResponse(200, {}); } });
  exports.applyAnalyzerAssertion({
    assertion: VALID_ASSERTION_1, expires_at: Date.now() + 1000, department_id: 5,
    renewal: VALID_OPAQUE_A, renewal_expires_at: Date.now() - 1, // already past absolute expiry
  });
  await exports.renewAnalyzerAssertion();
  assert.equal(called, false);
  assert.equal(exports.state.mode, 'cookie');
});

// ── analyzerAuthenticatedFetch: credentials, expiry/renewal, access boundaries ──

test('authenticated fetch: cookie mode (no assertion/handoff ever established) sends credentials include, no bearer', async () => {
  const calls = [];
  const { exports } = await createSandbox({ fetchImpl: async (url, init) => { calls.push(init); return jsonResponse(200, { ok: true }); } });
  const res = await exports.analyzerAuthenticatedFetch('https://berklee.bryandimaio.com/analyzer/context', { headers: {} });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].credentials, 'include');
  assert.equal(calls[0].headers.Authorization, undefined);
});

test('authenticated fetch: assertion mode sends the bearer token with credentials omit', async () => {
  const calls = [];
  const { exports } = await createSandbox({ fetchImpl: async (url, init) => { calls.push(init); return jsonResponse(200, { ok: true }); } });
  exports.applyAnalyzerAssertion({ assertion: VALID_ASSERTION_1, expires_at: Date.now() + 300000, department_id: 5 });
  await exports.analyzerAuthenticatedFetch('https://berklee.bryandimaio.com/analyzer/context', { headers: {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].credentials, 'omit');
  assert.equal(calls[0].headers.Authorization, `Bearer ${VALID_ASSERTION_1}`);
});

test('authenticated fetch: department/access boundary (403) with a usable renewal retries once with the renewed bearer', async () => {
  const calls = [];
  let call = 0;
  const fetchImpl = async (url, init) => {
    call += 1;
    calls.push({ url, init });
    if (url.endsWith('/analyzer/context')) {
      return call === 1 ? jsonResponse(403, { error: 'analyzer_access_denied' }) : jsonResponse(200, { ok: true });
    }
    // /analyzer/auth/renew
    return jsonResponse(200, {
      assertion: VALID_ASSERTION_2, expires_at: Date.now() + 300000, department_id: 5,
      renewal: VALID_OPAQUE_B, renewal_expires_at: Date.now() + 3600000,
    });
  };
  const { exports } = await createSandbox({ fetchImpl });
  exports.applyAnalyzerAssertion({
    assertion: VALID_ASSERTION_1, expires_at: Date.now() + 300000, department_id: 5,
    renewal: VALID_OPAQUE_A, renewal_expires_at: Date.now() + 3600000,
  });
  const res = await exports.analyzerAuthenticatedFetch('https://berklee.bryandimaio.com/analyzer/context', { headers: {} });
  assert.equal(res.status, 200);
  assert.equal(exports.state.mode, 'assertion');
  assert.equal(exports.state.assertion.token, VALID_ASSERTION_2);
  const contextCalls = calls.filter((c) => c.url.endsWith('/analyzer/context'));
  assert.equal(contextCalls.length, 2);
  assert.equal(contextCalls[0].init.headers.Authorization, `Bearer ${VALID_ASSERTION_1}`);
  assert.equal(contextCalls[1].init.headers.Authorization, `Bearer ${VALID_ASSERTION_2}`);
  assert.equal(contextCalls[1].init.credentials, 'omit');
});

test('authenticated fetch: 401 with no renewal available (revoked/expired) falls back to the cookie path', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/analyzer/context')) return jsonResponse(401, { error: 'invalid_analyzer_assertion' });
    return jsonResponse(200, { ok: true });
  };
  const { exports } = await createSandbox({ fetchImpl });
  exports.applyAnalyzerAssertion({ assertion: VALID_ASSERTION_1, expires_at: Date.now() + 300000, department_id: 5 }); // no renewal
  const res = await exports.analyzerAuthenticatedFetch('https://berklee.bryandimaio.com/analyzer/context', { headers: {} });
  assert.equal(res.status, 401);
  assert.equal(exports.state.mode, 'cookie');
  const contextCalls = calls.filter((c) => c.url.endsWith('/analyzer/context'));
  assert.equal(contextCalls.length, 2);
  assert.equal(contextCalls[1].init.credentials, 'include');
  assert.equal(contextCalls[1].init.headers.Authorization, undefined);
});

test('authenticated fetch: an already-expired in-memory assertion is not sent; falls straight to cookie mode', async () => {
  const calls = [];
  const { exports } = await createSandbox({ fetchImpl: async (url, init) => { calls.push(init); return jsonResponse(200, { ok: true }); } });
  exports.applyAnalyzerAssertion({ assertion: VALID_ASSERTION_1, expires_at: Date.now() - 1, department_id: 5 });
  await exports.analyzerAuthenticatedFetch('https://berklee.bryandimaio.com/analyzer/context', { headers: {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].credentials, 'include');
});

// ── establishAnalyzerAuth: overall precedence and "logout"-equivalent no-op ────

test('establishAnalyzerAuth: handoff takes precedence over the embedded handshake', async () => {
  let posted = false;
  const fetchImpl = async () => jsonResponse(200, {
    assertion: VALID_ASSERTION_1, expires_at: Date.now() + 300000, department_id: 9,
    renewal: VALID_OPAQUE_B, renewal_expires_at: Date.now() + 3600000,
  });
  const { exports } = await createSandbox({ embedded: true, hash: `#handoff=${VALID_OPAQUE_A}`, posted: () => { posted = true; }, fetchImpl });
  await exports.establishAnalyzerAuth();
  assert.equal(exports.state.mode, 'assertion');
  assert.equal(posted, false); // never needed to attempt the handshake
});

test('establishAnalyzerAuth: no handoff and not embedded (or Scheduler not yet answering) leaves cookie mode untouched', async () => {
  const { exports } = await createSandbox({ embedded: false, fetchImpl: async () => jsonResponse(500, {}) });
  await exports.establishAnalyzerAuth();
  assert.equal(exports.state.mode, 'cookie');
  assert.equal(exports.state.assertion, null);
});
