# 微信测试号接入

目标：先在自己的手机验证提醒，再接入 Win11 真实识别。以下是开发版本，尚未部署，无图形化绑定界面，只支持一台电脑与一个微信接收人；不支持公开多用户运营。

## 第一步：最小真实推送

1. 打开微信官方测试号后台：<https://mp.weixin.qq.com/debug/cgi-bin/sandbox?t=sandbox/login>，由账号本人扫码登录。
2. 在测试号信息处找到 AppID / AppSecret。不要发在聊天、issue 或截图里。
3. 用接收提醒的微信扫描测试号后台的关注二维码。在用户列表中找到该用户的 OpenID（不是微信号）。
4. 新增测试模板，标题可填“GamePulse 匹配提醒”，内容如下：

```text
提醒：{{status.DATA}}
时间：{{time.DATA}}
```

5. 复制根目录 `.env.example` 为 `.env`，只在本地填写 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`WECHAT_TEST_OPEN_ID`、`WECHAT_TEMPLATE_ID`。不要修改 `.env.example` 中的空值。Windows 可用 `Copy-Item .env.example .env`。
6. 安装 Node.js 24+，在项目根目录运行 `npm run wechat:test`。命令会真正发送一条测试消息到配置的微信；每次执行都会再次发送。
7. 手机锁屏、微信退到后台后测试，记录收到时间、响铃/震动效果、网络和免打扰状态。微信 API 受理成功不是已送达的证明。

如果返回 IP 白名单相关错误，在微信后台确认当前接口调用出口 IP 的配置。不要把 AppSecret 放到用户安装包中；本地直发工具仅用于开发者自测。

## 第二步：临时二维码绑定与开发网关

本地补齐配置：

- `WECHAT_CALLBACK_TOKEN`：自己随机生成的回调校验密钥，不是 access_token。
- `WECHAT_ACCOUNT_ID`：公众号原始 ID，即回调 XML 的 ToUserName；不要填 AppID。
- `GAMEPULSE_PUBLISHER_TOKEN`：至少 32 字符的随机开发凭证，仅授权当前这一台电脑。

启动 `npm run wechat:gateway`，默认只监听 `127.0.0.1:8788`。

对外接收回调时，应使用具备可信 HTTPS 的开发代理，仅转发 `/wechat/callback`，不要暴露 `/v1/*` 或本地文件。此版本只支持测试环境的明文 XML 回调，不支持微信安全模式加密消息。不要为了迁就此实现而降低既有正式服务号的安全设置。

在测试号后台配置回调地址 `https://你的开发域名/wechat/callback` 及相同 Token。GET 用于微信校验，POST 用于关注、扫码、取消关注事件。校验包含签名、时间窗、目标公众号和输入长度限制。开发代理/服务器应关闭查询参数与请求体日志，避免记录微信标识和凭证。

开发接口（全部 `/v1/*` 请求均需 `Authorization: Bearer <GAMEPULSE_PUBLISHER_TOKEN>`）：

| 方法与路径 | 效果 |
| --- | --- |
| POST `/v1/wechat/pairing` | 向微信申请 5 分钟临时二维码，返回 imageUrl 和 expiresAt；申请新码会替换之前待绑定码 |
| GET `/v1/wechat/pairing` | 查询是否绑定，不返回 OpenID |
| DELETE `/v1/wechat/pairing` | 清除当前绑定和待绑定码 |
| POST `/v1/events` | 将合法协议事件发给当前绑定的接收人 |

用手机打开/扫描返回的二维码图像，关注或确认后由微信回调完成绑定。二维码应只交给预期接收人；首个扫描有效码的用户成为接收人，此开发版本还没有二次确认页面。

为原模拟电脑端设置 `GAMEPULSE_RELAY_URL=http://127.0.0.1:8788` 和对应发布凭证后，运行 `npm run demo`，可将模拟匹配事件送到微信；这会发送真实消息。没有真实配置时，`npm test` 只使用模拟网络响应，不向微信发送消息。

消息接口返回 accepted 只代表微信已受理。超时可能已发送，因此网关对同一事件在 5 分钟内不盲目重发，状态为 failed_or_unknown 时需要人工核对。绑定、去重记录均在内存中，重启后需重新绑定。尚无按用户限流、持久队列、加密回调、送达回执、图形化二维码展示和多租户隔离。

## 正式服务号迁移

测试号只是开发工具，不是公开上线的替代品。测试号与正式号 AppID 不同，OpenID 和模板 ID 不能直接沿用，用户需关注正式号并重新绑定。

上线前须在正式号后台核验：主体与认证资格、实际接口权限、适用的游戏提醒模板、配额和行业规则。模板字段不能假设仍叫 status/time；当前映射仅针对上面的测试模板，正式模板需要另行适配与测试。不能用无关交易模板伪装游戏提醒。

官方参考：

- [测试号入口](https://mp.weixin.qq.com/debug/cgi-bin/sandbox?t=sandbox/login)
- [模板消息接口](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Template_Message_Interface.html)
- [带参数二维码](https://developers.weixin.qq.com/doc/offiaccount/Account_Management/Generating_a_Parametric_QR_Code.html)

部分官方文档在当前检索环境不可访问，接口实现需在真实测试号中验证后再确认兼容性，不能仅凭模拟测试判定微信端可用。
