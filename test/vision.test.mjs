import { test } from 'node:test';
import assert from 'node:assert/strict';
import reference from '../packages/vision/lol-reference.json' with { type: 'json' };
import { correlation, describe, scoreFrame } from '../packages/vision/index.mjs';
import { createConsole } from '../apps/desktop-console/server.mjs';
import { once } from 'node:events';

test('correlation tolerates brightness shifts and rejects blank or unrelated descriptors', () => {
  const a = reference.anchors[0].values;
  assert.ok(correlation(a, a.map(x => x * .8 + 10)) > .999);
  assert.equal(correlation(a, a.map(() => 0)), 0);
  assert.ok(correlation(a, [...a].reverse()) < .9);
  assert.throws(() => correlation(a, [NaN]));
});
test('blank client does not trigger and samples remain within bounds', () => {
  const frame = { width: 640, height: 324, data: new Uint8ClampedArray(640 * 324 * 4) };
  assert.equal(scoreFrame(frame, reference).confidence, 0);
  assert.throws(() => describe(frame, { x: 600, y: 300, width: 60, height: 30 }));
});
test('both independent anchors must agree', () => {
  const frame = { width: 640, height: 324, data: new Uint8ClampedArray(640 * 324 * 4) };
  const anchor = reference.anchors[0];
  for (let y = 0; y < anchor.rect.height; y++) for (let x = 0; x < anchor.rect.width; x++) {
    const i = ((y + anchor.rect.y) * 640 + x + anchor.rect.x) * 4;
    frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = ((x + y) % 2) * 255;
  }
  assert.equal(scoreFrame(frame, reference).confidence, 0);
});
test('local console protects writes and credentials, debounces and forwards metadata once', async t => {
  let sent = 0;
  const publisherToken = 'secret'.repeat(8);
  const server = createConsole({ publisherToken, fetchImpl: async (url, options) => {
    sent++; assert.equal(url.pathname, '/v1/events');
    const body = JSON.parse(options.body);
    assert.equal(body.type, 'match.found'); assert.equal(Object.keys(body).length, 6);
    return new Response(JSON.stringify({ status: 'accepted' }), { status: 202 });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(base + '/api/session')).json();
  assert.ok(!JSON.stringify(session).includes(publisherToken));
  const post = (path, body, origin = base) => fetch(base + '/api/' + path, {
    method: 'POST', headers: { origin, 'x-gamepulse-csrf': session.csrf, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  assert.equal((await post('arm', {}, 'https://other.example')).status, 403);
  assert.equal((await fetch(base + '/.env')).status, 403);
  assert.equal((await post('arm')).status, 200);
  assert.equal((await post('observe', { confidence: 1, screenshot: 'private' })).status, 400);
  for (let i = 0; i < 4; i++) { await post('observe', { confidence: .98 }); await new Promise(r => setTimeout(r, 3)); }
  assert.equal(sent, 1);
  assert.equal((await post('stop')).status, 200);
});
