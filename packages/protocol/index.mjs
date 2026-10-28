export const VERSION = 1;
export const EVENT_TYPE = 'match.found';

/** Protocol v1 carries metadata only, never screenshots or audio. */
export function validateEvent(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = ['version', 'type', 'id', 'sessionId', 'occurredAt', 'confidence'];
  if (Object.keys(value).length !== keys.length || !keys.every(k => Object.hasOwn(value, k))) return false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return value.version === VERSION && value.type === EVENT_TYPE &&
    typeof value.id === 'string' && uuid.test(value.id) &&
    typeof value.sessionId === 'string' && uuid.test(value.sessionId) &&
    Number.isSafeInteger(value.occurredAt) && Math.abs(now - value.occurredAt) <= 300_000 &&
    Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1;
}
