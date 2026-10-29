import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { verifyCallback, parseCallback } from '../../packages/wechat/callback.mjs';
import { Pairing } from '../../packages/wechat/pairing.mjs';
import { validateEvent } from '../../packages/protocol/index.mjs';

async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    if ((size += chunk.length) > limit) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createWeChatGateway({ client, publisherToken, callbackToken, accountId, templateId, now = Date.now }) {
  if (!client || !publisherToken || publisherToken.length < 32 || !callbackToken || !accountId || !templateId) {
    throw new Error('Missing WeChat gateway configuration');
  }
  const pairing = new Pairing({ now });
  const deliveries = new Map();
  return createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => {
    const reply = (code, body, text = false) => {
      res.writeHead(code, { 'content-type': text ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store' });
      res.end(text ? body : JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/wechat/callback' && ['GET', 'POST'].includes(req.method)) {
        if (!verifyCallback(url.searchParams, callbackToken, now())) return reply(403, 'forbidden', true);
        if (req.method === 'GET') {
          const echo = url.searchParams.get('echostr');
          if (!echo || echo.length > 256) return reply(400, 'invalid_echo', true);
          return reply(200, echo, true);
        }
        const event = parseCallback(await readBody(req, 8192));
        if (event.ToUserName !== accountId) return reply(403, 'wrong_account', true);
        pairing.apply(event);
        return reply(200, 'success', true);
      }
      if (url.pathname === '/health' && req.method === 'GET') return reply(200, { status: 'ok' });
      const actual = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${publisherToken}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply(401, { error: 'unauthorized' });
      if (url.pathname === '/v1/wechat/pairing') {
        if (req.method === 'GET') return reply(200, { bound: Boolean(pairing.openId) });
        if (req.method === 'DELETE') { pairing.unbind(); return reply(200, { bound: false }); }
        if (req.method === 'POST') {
          const pending = pairing.begin();
          const qr = await client.createPairingQr(pending.scene);
          return reply(201, { ...qr, expiresAt: pending.expiresAt });
        }
      }
      if (url.pathname !== '/v1/events' || req.method !== 'POST') return reply(404, { error: 'not_found' });
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return reply(415, { error: 'json_required' });
      let event;
      try { event = JSON.parse(await readBody(req, 4096)); } catch { return reply(400, { error: 'invalid_json_or_size' }); }
      if (!validateEvent(event, now())) return reply(400, { error: 'invalid_event' });
      for (const [id, value] of deliveries) if (value.expiresAt <= now()) deliveries.delete(id);
      const existing = deliveries.get(event.id);
      if (existing) return reply(existing.status === 'accepted' ? 200 : 409, { duplicate: true, status: existing.status });
      const openId = pairing.openId;
      if (!openId) return reply(409, { error: 'wechat_not_bound' });
      if (deliveries.size >= 1000) return reply(503, { error: 'capacity_reached' });
      const delivery = { status: 'pending', expiresAt: now() + 300000 };
      deliveries.set(event.id, delivery);
      try {
        await client.sendTemplate({ openId, templateId, data: {
          status: { value: '匹配成功，请返回电脑' },
          time: { value: new Date(event.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }
        } });
        delivery.status = 'accepted';
        return reply(202, { status: 'accepted' });
      } catch {
        delivery.status = 'failed_or_unknown';
        return reply(502, { error: 'wechat_delivery_failed_or_unknown' });
      }
    } catch { if (!res.headersSent) reply(400, { error: 'invalid_request_or_provider_failure' }); }
  });
}
