import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { MatchMonitor } from '../../packages/core/index.mjs';

const assets = {
  '/': ['public/index.html', 'text/html'], '/app.mjs': ['public/app.mjs', 'text/javascript'],
  '/style.css': ['public/style.css', 'text/css'],
  '/vision.mjs': ['../../packages/vision/index.mjs', 'text/javascript'],
  '/reference.json': ['../../packages/vision/lol-reference.json', 'application/json']
};
export function createConsole({ publisherToken, relayUrl = 'http://127.0.0.1:18788', fetchImpl = fetch } = {}) {
  if (!publisherToken || publisherToken.length < 32) throw new Error('GAMEPULSE_PUBLISHER_TOKEN must contain at least 32 characters');
  const relay = new URL(relayUrl);
  if (relay.username || relay.password || relay.search || relay.hash || relay.pathname !== '/' ||
      (relay.protocol !== 'https:' && !(relay.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(relay.hostname)))) throw new Error('Use HTTPS or a loopback SSH tunnel');
  const csrf = randomBytes(32).toString('hex');
  const monitor = new MatchMonitor({ threshold: .90, confirmations: 3, maxGapMs: 1500 });
  let busy = false;
  return createServer({ requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const origin = `http://127.0.0.1:${req.socket.localPort}`;
      if (req.headers.host !== new URL(origin).host) return reply(403, { error: 'invalid_host' });
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && assets[url.pathname]) {
        const [path, mime] = assets[url.pathname];
        res.writeHead(200, { 'content-type': `${mime}; charset=utf-8`, 'cache-control': 'no-store',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
        return res.end(await readFile(new URL(path, import.meta.url)));
      }
      if (req.method === 'GET' && url.pathname === '/api/session') return reply(200, { csrf, state: monitor.state });
      const supplied = Buffer.from(req.headers['x-gamepulse-csrf'] ?? '');
      const expected = Buffer.from(csrf);
      if (req.method !== 'POST' || req.headers.origin !== origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(403, { error: 'invalid_local_request' });
      if (url.pathname === '/api/arm') {
        if (busy) return reply(409, { error: 'delivery_in_progress' });
        monitor.arm(); return reply(200, { state: monitor.state });
      }
      if (url.pathname === '/api/stop') { monitor.disarm(); return reply(200, { state: monitor.state }); }
      if (url.pathname !== '/api/observe') return reply(404, { error: 'not_found' });
      if (busy) return reply(409, { error: 'delivery_in_progress' });
      let size = 0; const chunks = [];
      for await (const chunk of req) { if ((size += chunk.length) > 512) return reply(413, { error: 'too_large' }); chunks.push(chunk); }
      const sample = JSON.parse(Buffer.concat(chunks));
      if (Object.keys(sample).length !== 1 || !Object.hasOwn(sample, 'confidence')) return reply(400, { error: 'invalid_sample' });
      const event = monitor.observe({ confidence: sample.confidence, observedAt: Date.now() });
      if (!event) return reply(200, { state: monitor.state });
      busy = true;
      try {
        const upstream = await fetchImpl(new URL('/v1/events', relay), { method: 'POST',
          headers: { authorization: `Bearer ${publisherToken}`, 'content-type': 'application/json' },
          body: JSON.stringify(event), signal: AbortSignal.timeout(8000) });
        if (!upstream.ok) return reply(502, { error: `gateway_http_${upstream.status}`, state: monitor.state });
        return reply(200, { state: monitor.state, delivery: 'accepted' });
      } catch { return reply(502, { error: 'delivery_failed_or_unknown', state: monitor.state }); }
      finally { busy = false; }
    } catch { if (!res.headersSent) reply(400, { error: 'invalid_request' }); }
  });
}
