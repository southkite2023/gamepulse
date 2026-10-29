import { createHash, timingSafeEqual } from 'node:crypto';

export function verifyCallback(params, token, now = Date.now()) {
  const signature = params.get('signature'), timestamp = params.get('timestamp'), nonce = params.get('nonce');
  if (!token || !/^[a-f0-9]{40}$/.test(signature ?? '') || !/^\d{10}$/.test(timestamp ?? '') ||
      !nonce || nonce.length > 128 || Math.abs(now - Number(timestamp) * 1000) > 300_000) return false;
  const expected = createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex');
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** Strict plaintext event subset; encrypted callbacks are deliberately unsupported. */
export function parseCallback(xml) {
  if (Buffer.byteLength(xml) > 8192 || /<!DOCTYPE|<!ENTITY|<Encrypt[\s>]/i.test(xml) ||
      !/^\s*<xml>[\s\S]*<\/xml>\s*$/.test(xml)) throw new Error('Unsupported callback XML');
  const fields = {};
  const inner = xml.trim().slice(5, -6);
  const pattern = /\s*<([A-Za-z][A-Za-z0-9_]*)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<>]*))<\/\1>/gy;
  let position = 0;
  while (position < inner.length && inner.slice(position).trim()) {
    pattern.lastIndex = position;
    const match = pattern.exec(inner);
    if (!match || Object.hasOwn(fields, match[1])) throw new Error('Malformed callback XML');
    fields[match[1]] = match[2] ?? match[3]; position = pattern.lastIndex;
  }
  if (fields.MsgType !== 'event' || !fields.FromUserName || !fields.ToUserName || !/^\d+$/.test(fields.CreateTime ?? '')) {
    throw new Error('Unsupported callback event');
  }
  return fields;
}
