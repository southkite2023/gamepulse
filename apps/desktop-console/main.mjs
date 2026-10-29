import { createConsole } from './server.mjs';
const port = Number(process.env.GAMEPULSE_CONSOLE_PORT ?? 8790);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid console port');
const server = createConsole({ publisherToken: process.env.GAMEPULSE_PUBLISHER_TOKEN,
  relayUrl: process.env.GAMEPULSE_RELAY_URL ?? 'http://127.0.0.1:18788' });
server.on('error', error => { console.error(`启动失败: ${error.code}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`在 Edge 打开 http://127.0.0.1:${port} 。图像只在本机分析。`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
