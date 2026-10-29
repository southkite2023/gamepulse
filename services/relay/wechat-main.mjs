import { WeChatClient } from '../../packages/wechat/client.mjs';
import { createWeChatGateway } from './wechat-server.mjs';
const env = process.env;
const client = new WeChatClient({ appId: env.WECHAT_APP_ID, appSecret: env.WECHAT_APP_SECRET });
const server = createWeChatGateway({ client, publisherToken: env.GAMEPULSE_PUBLISHER_TOKEN,
  callbackToken: env.WECHAT_CALLBACK_TOKEN, accountId: env.WECHAT_ACCOUNT_ID, templateId: env.WECHAT_TEMPLATE_ID });
const port = Number(env.PORT ?? 8788);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
server.on('error', error => { console.error(`微信开发网关启动失败: ${error.code}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`微信开发网关: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
