import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WeChatClient } from '../packages/wechat/client.mjs';
import { verifyCallback, parseCallback } from '../packages/wechat/callback.mjs';
import { Pairing } from '../packages/wechat/pairing.mjs';
import { createWeChatGateway } from '../services/relay/wechat-server.mjs';

const now = 1800000000000;
function signed(token = 'callback-secret') {
  const timestamp = String(now / 1000), nonce = 'nonce';
  return new URLSearchParams({ timestamp, nonce, signature: createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex') });
}
function xml(scene, recipient = 'account') {
  return `<xml><ToUserName><![CDATA[${recipient}]]></ToUserName><FromUserName><![CDATA[user]]></FromUserName><CreateTime>${now / 1000}</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event><EventKey><![CDATA[qrscene_${scene}]]></EventKey></xml>`;
}
const json = value => new Response(JSON.stringify(value));
test('token caching coalesces concurrent requests; explicit expiration refreshes once', async () => {
  let tokens = 0, sends = 0;
  const client = new WeChatClient({ appId: 'id', appSecret: 'secret', now: () => now,
    fetchImpl: async (url, options) => {
      if (url.pathname.endsWith('/token')) return json({ access_token: `token${++tokens}`, expires_in: 7200 });
      sends++; assert.equal(JSON.parse(options.body).touser, 'user');
      if (sends === 1) return json({ errcode: 42001 });
      return json({ errcode: 0, msgid: sends });
    } });
  const message = { openId: 'user', templateId: 'template', data: { status: { value: 'test' } } };
  await client.sendTemplate(message);
  assert.equal(tokens, 2);
  await Promise.all([client.sendTemplate(message), client.sendTemplate(message)]);
  assert.equal(tokens, 2);
});
test('ambiguous network failure is not retried and errors do not leak credentials', async () => {
  let sends = 0;
  const client = new WeChatClient({ appId: 'id', appSecret: 'secret', fetchImpl: async url => {
    if (url.pathname.endsWith('/token')) return json({ access_token: 'private-token', expires_in: 7200 });
    sends++; throw new Error(`Network failed at ${url}`);
  } });
  await assert.rejects(client.sendTemplate({ openId: 'user', templateId: 'template', data: {} }), error => !error.message.includes('private-token'));
  assert.equal(sends, 1);
});
test('callback authentication rejects tampering and stale timestamps; XML rejects entities and duplicates', () => {
  assert.ok(verifyCallback(signed(), 'callback-secret', now));
  assert.equal(verifyCallback(signed(), 'wrong', now), false);
  assert.equal(verifyCallback(signed(), 'callback-secret', now + 300001), false);
  assert.equal(parseCallback(xml('scene')).FromUserName, 'user');
  assert.throws(() => parseCallback('<!DOCTYPE xml>' + xml('scene')));
  assert.throws(() => parseCallback(xml('scene').replace('</xml>', '<Event>SCAN</Event></xml>')));
});
test('pairing is single-use, expires and unbinds on unsubscribe', () => {
  let time = now;
  const pairing = new Pairing({ now: () => time });
  const first = pairing.begin();
  assert.equal(pairing.apply(parseCallback(xml('wrong'))), false);
  assert.ok(pairing.apply(parseCallback(xml(first.scene))));
  assert.equal(pairing.apply(parseCallback(xml(first.scene))), false);
  assert.equal(pairing.openId, 'user');
  assert.ok(pairing.apply({ Event: 'unsubscribe', FromUserName: 'user', CreateTime: now / 1000 }));
  assert.equal(pairing.openId, undefined);
  const second = pairing.begin(); time += 300001;
  assert.equal(pairing.apply({ ...parseCallback(xml(second.scene)), CreateTime: Math.floor(time / 1000) }), false);
});
test('gateway binds via signed QR callback and routes an event once to the bound user', async t => {
  let scene, sends = 0;
  const publisherToken = 'p'.repeat(32);
  const server = createWeChatGateway({ publisherToken, callbackToken: 'callback-secret', accountId: 'account', templateId: 'template', now: () => now,
    client: { createPairingQr: async value => { scene = value; return { imageUrl: 'https://mp.weixin.qq.com/qr' }; },
      sendTemplate: async message => { sends++; assert.equal(message.openId, 'user'); return { status: 'accepted' }; } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = (path, method = 'GET', body) => fetch(base + path, { method,
    headers: { authorization: `Bearer ${publisherToken}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await fetch(base + '/v1/wechat/pairing')).status, 401);
  assert.equal((await admin('/v1/wechat/pairing', 'POST')).status, 201);
  assert.equal((await fetch(`${base}/wechat/callback?${signed()}&echostr=hello`)).status, 200);
  assert.equal((await fetch(`${base}/wechat/callback?${signed()}`, { method: 'POST', body: xml(scene, 'other') })).status, 403);
  assert.equal((await fetch(`${base}/wechat/callback?${signed()}`, { method: 'POST', body: xml(scene) })).status, 200);
  assert.deepEqual(await (await admin('/v1/wechat/pairing')).json(), { bound: true });
  const event = { version: 1, type: 'match.found', id: randomUUID(), sessionId: randomUUID(), occurredAt: now, confidence: 1 };
  assert.equal((await admin('/v1/events', 'POST', event)).status, 202);
  assert.equal((await admin('/v1/events', 'POST', event)).status, 200);
  assert.equal(sends, 1);
  await admin('/v1/wechat/pairing', 'DELETE');
  assert.equal((await admin('/v1/events', 'POST', { ...event, id: randomUUID() })).status, 409);
});
