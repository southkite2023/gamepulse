import { randomUUID } from 'node:crypto';
import { VERSION, EVENT_TYPE } from '../protocol/index.mjs';

/** Detector adapters supply {confidence, observedAt}; the core owns debouncing. */
export class MatchMonitor {
  #state = 'idle';
  #sessionId;
  #count = 0;
  #lastTime = -Infinity;
  constructor({ threshold = 0.9, confirmations = 2, maxGapMs = 2_000 } = {}) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 ||
        !Number.isInteger(confirmations) || confirmations < 1 ||
        !Number.isFinite(maxGapMs) || maxGapMs <= 0) throw new TypeError('Invalid monitor configuration');
    this.threshold = threshold;
    this.confirmations = confirmations;
    this.maxGapMs = maxGapMs;
  }
  get state() { return this.#state; }
  arm() {
    this.#sessionId = randomUUID();
    this.#count = 0;
    this.#lastTime = -Infinity;
    this.#state = 'armed';
    return this.#sessionId;
  }
  disarm() { this.#state = 'idle'; this.#count = 0; }
  observe({ confidence, observedAt }) {
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1 ||
        !Number.isSafeInteger(observedAt) || observedAt < 0) throw new TypeError('Invalid observation');
    if (this.#state === 'idle' || this.#state === 'notified' || observedAt <= this.#lastTime) return null;
    if (observedAt - this.#lastTime > this.maxGapMs) this.#count = 0;
    this.#lastTime = observedAt;
    if (confidence < this.threshold) { this.#count = 0; this.#state = 'armed'; return null; }
    this.#state = 'candidate';
    if (++this.#count < this.confirmations) return null;
    this.#state = 'notified';
    return { version: VERSION, type: EVENT_TYPE, id: randomUUID(),
      sessionId: this.#sessionId, occurredAt: observedAt, confidence };
  }
}
