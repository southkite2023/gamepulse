import { MatchMonitor } from '../../packages/core/index.mjs';
import { relayUrl } from '../../packages/protocol/client.mjs';
const token = process.env.GAMEPULSE_PUBLISHER_TOKEN;
if (!token) throw new Error('GAMEPULSE_PUBLISHER_TOKEN is required');
const monitor = new MatchMonitor();
monitor.arm();
// This deterministic adapter demonstrates the contract; it does not capture a game.
const startedAt = Date.now() - 3000;
for (const [index, confidence] of [0.1, 0.93, 0.2, 0.95, 0.98].entries()) {
  const event = monitor.observe({ confidence, observedAt: startedAt + index * 500 });
  if (!event) continue;
  let delivered = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(relayUrl('/v1/events'), {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(event), signal: AbortSignal.timeout(5000)
      });
      if (response.ok) { delivered = true; console.log('模拟匹配事件已发送:', event.id); break; }
      if (response.status < 500) throw new Error(`Relay rejected event: ${response.status}`);
    } catch (error) { if (attempt === 2) throw error; }
  }
  if (!delivered) throw new Error('Delivery failed after 3 attempts');
}
