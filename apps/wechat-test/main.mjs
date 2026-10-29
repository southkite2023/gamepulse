import { WeChatClient } from '../../packages/wechat/client.mjs';
const { WECHAT_APP_ID: appId, WECHAT_APP_SECRET: appSecret, WECHAT_TEST_OPEN_ID: openId, WECHAT_TEMPLATE_ID: templateId } = process.env;
if (!openId || !templateId) throw new Error('WECHAT_TEST_OPEN_ID and WECHAT_TEMPLATE_ID are required');
const client = new WeChatClient({ appId, appSecret });
try {
  const result = await client.sendTemplate({ openId, templateId, data: {
    status: { value: '匹配提醒测试：请返回电脑' },
    time: { value: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }
  } });
  console.log(`微信已受理测试消息（${result.messageId}）。请检查手机锁屏提醒；受理不代表已送达。`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
