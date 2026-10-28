import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchMonitor } from '../packages/core/index.mjs';
import { validateEvent } from '../packages/protocol/index.mjs';

test('requires arming, consecutive evidence, and emits once per session', () => {
  const monitor = new MatchMonitor();
  const observe = (confidence, observedAt) => monitor.observe({ confidence, observedAt });
  assert.equal(observe(1, 1), null);
  monitor.arm();
  assert.equal(observe(0.95, 2), null);
  assert.equal(observe(0.1, 3), null);
  assert.equal(observe(0.95, 4), null);
  const event = observe(0.99, 5);
  assert.ok(validateEvent(event, 5));
  assert.equal(monitor.state, 'notified');
  assert.equal(observe(1, 6), null);
  monitor.arm();
  observe(1, 7);
  assert.notEqual(observe(1, 8).sessionId, event.sessionId);
  monitor.disarm();
  assert.equal(observe(1, 9), null);
});

test('ignores repeated or old samples and resets evidence after gaps', () => {
  const monitor = new MatchMonitor(); monitor.arm();
  monitor.observe({ confidence: 1, observedAt: 10 });
  assert.equal(monitor.observe({ confidence: 1, observedAt: 10 }), null);
  assert.equal(monitor.observe({ confidence: 1, observedAt: 9 }), null);
  assert.equal(monitor.observe({ confidence: 1, observedAt: 3000 }), null);
  assert.ok(monitor.observe({ confidence: 1, observedAt: 3001 }));
});

test('rejects invalid configuration and observations', () => {
  for (const threshold of [NaN, -1, 2]) assert.throws(() => new MatchMonitor({ threshold }));
  const monitor = new MatchMonitor();
  for (const confidence of [NaN, Infinity, -1, 2]) {
    assert.throws(() => monitor.observe({ confidence, observedAt: 1 }));
  }
});
