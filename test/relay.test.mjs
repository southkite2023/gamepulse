import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRelay } from '../services/relay/server.mjs';
import { MatchMonitor } from '../packages/core/index.mjs';

const publisherToken = 'p'.repeat(32), receiverToken = 'r'.repeat(32);
async function fixture(t, options = {}) {
  const server = createRelay({ publisherToken, receiverToken, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return (method, token, body, suffix = '') => fetch(`http://127.0.0.1:${server.address().port}/v1/events${suffix}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
  });
}
function event(now = Date.now()) {
  return { version: 1, type: 'match.found', id: randomUUID(), sessionId: randomUUID(), occurredAt: now, confidence: 0.98 };
}
test('full chain: monitor → authenticated relay → receiver, with duplicate suppression', async t => {
  const request = await fixture(t);
  const monitor = new MatchMonitor(); monitor.arm();
  monitor.observe({ confidence: 0.95, observedAt: Date.now() - 1 });
  const match = monitor.observe({ confidence: 0.98, observedAt: Date.now() });
  assert.equal((await request('POST', publisherToken, match)).status, 202);
  assert.deepEqual(await (await request('POST', publisherToken, match)).json(), { duplicate: true });
  const received = await (await request('GET', receiverToken)).json();
  assert.equal(received.events.length, 1);
  assert.deepEqual(received.events[0].event, match);
  assert.deepEqual((await (await request('GET', receiverToken, undefined, '?after=1')).json()).events, []);
});
test('separates publisher and receiver permissions and rejects malformed input', async t => {
  const request = await fixture(t);
  assert.equal((await request('GET', publisherToken)).status, 401);
  assert.equal((await request('POST', receiverToken, event())).status, 401);
  for (const bad of ['{', {}, event(0), { ...event(), screenshot: 'private' }, { ...event(), confidence: 2 }]) {
    assert.equal((await request('POST', publisherToken, bad)).status, 400);
  }
  assert.equal((await request('POST', publisherToken, 'x'.repeat(5000))).status, 413);
  assert.equal((await request('GET', receiverToken, undefined, '?after=-1')).status, 400);
});
test('bounds storage, expires records and reports missed events or server restart', async t => {
  let now = Date.now();
  const request = await fixture(t, { capacity: 1, now: () => now });
  const first = event(now);
  assert.equal((await request('POST', publisherToken, first)).status, 202);
  assert.equal((await request('POST', publisherToken, event(now))).status, 503);
  now += 300_001;
  assert.equal((await request('GET', receiverToken)).status, 409);
  assert.equal((await request('POST', publisherToken, event(now))).status, 202);
  assert.equal((await request('GET', receiverToken, undefined, '?after=1')).status, 200);
  assert.equal((await request('GET', receiverToken, undefined, '?after=99')).status, 409);
});
test('refuses missing, short or shared credentials', () => {
  assert.throws(() => createRelay());
  assert.throws(() => createRelay({ publisherToken, receiverToken: publisherToken }));
  assert.throws(() => createRelay({ publisherToken, receiverToken: 'short' }));
});
