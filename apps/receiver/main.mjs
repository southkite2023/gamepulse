import { relayUrl } from '../../packages/protocol/client.mjs';
const token = process.env.GAMEPULSE_RECEIVER_TOKEN;
if (!token) throw new Error('GAMEPULSE_RECEIVER_TOKEN is required');
let cursor = 0;
console.log('等待模拟匹配事件（终端接收器，不是手机推送）…');
while (true) {
  try {
    const response = await fetch(relayUrl(`/v1/events?after=${cursor}`), {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000)
    });
    const body = await response.json();
    if (response.status === 409) { console.error('事件游标已失效，可能漏收；重新同步。'); cursor = body.latest; }
    else if (!response.ok) throw new Error(`Relay: ${response.status}`);
    else {
      for (const { event } of body.events) console.log('\u0007匹配成功（模拟）:', event.id);
      cursor = body.latest;
    }
  } catch (error) { console.error(error.message); }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
