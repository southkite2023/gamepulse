import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { validateEvent } from '../../packages/protocol/index.mjs';

const MAX_BODY = 4096;
function sameSecret(actual, expected) {
  const a = Buffer.from(actual ?? '');
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Single-pair development relay. All state expires on restart. */
export function createRelay({ publisherToken, receiverToken, capacity = 1000, now = Date.now } = {}) {
  if (typeof publisherToken !== 'string' || typeof receiverToken !== 'string' ||
      publisherToken.length < 32 || receiverToken.length < 32 || publisherToken === receiverToken ||
      !Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Two distinct tokens of at least 32 characters are required');
  let sequence = 0;
  const events = [];
  const ids = new Map();
  function prune() {
    const cutoff = now() - 300_000;
    while (events.length && events[0].acceptedAt < cutoff) events.shift();
    for (const [id, time] of ids) if (time < cutoff) ids.delete(id);
  }
  return createServer({ requestTimeout: 10_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return reply(200, { status: 'ok', version: 1 });
      const publishing = req.method === 'POST' && url.pathname === '/v1/events';
      const receiving = req.method === 'GET' && url.pathname === '/v1/events';
      if (!publishing && !receiving) return reply(404, { error: 'not_found' });
      if (!sameSecret(req.headers.authorization, publishing ? publisherToken : receiverToken)) return reply(401, { error: 'unauthorized' });
      prune();
      if (receiving) {
        const cursorText = url.searchParams.get('after') ?? '0';
        if (!/^\d+$/.test(cursorText) || !Number.isSafeInteger(Number(cursorText))) return reply(400, { error: 'invalid_cursor' });
        const after = Number(cursorText);
        if (after > sequence || (after < sequence && after < (events[0]?.sequence ?? sequence + 1) - 1)) {
          return reply(409, { error: 'cursor_expired', latest: sequence });
        }
        return reply(200, { events: events.filter(item => item.sequence > after).map(({ sequence, event }) => ({ sequence, event })), latest: sequence });
      }
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return reply(415, { error: 'json_required' });
      let body = '';
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) { reply(413, { error: 'body_too_large' }); return; }
        body += chunk.toString();
      }
      let event;
      try { event = JSON.parse(body); } catch { return reply(400, { error: 'invalid_json' }); }
      if (!validateEvent(event, now())) return reply(400, { error: 'invalid_event' });
      if (ids.has(event.id)) return reply(200, { duplicate: true });
      // Reject overflow instead of losing queued events or deduplication records.
      if (ids.size >= capacity) return reply(503, { error: 'queue_full' });
      ids.set(event.id, now());
      events.push({ sequence: ++sequence, event, acceptedAt: now() });
      return reply(202, { sequence, duplicate: false });
    } catch {
      if (!res.headersSent) reply(400, { error: 'bad_request' });
    }
  });
}
