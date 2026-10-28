import { createRelay } from './server.mjs';
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = createRelay({ publisherToken: process.env.GAMEPULSE_PUBLISHER_TOKEN, receiverToken: process.env.GAMEPULSE_RECEIVER_TOKEN });
server.on('error', error => { console.error(`中继启动失败: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`GamePulse relay: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
