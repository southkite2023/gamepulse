# GamePulse

Open-source cross-device game matchmaking detection and notifications.

游戏在电脑上匹配，人离开后由手机提醒。当前版本已搭建底层参考架构，可用模拟信号验证状态判断和事件传输；真实游戏识别与手机推送尚未实现。

## 快速验证

安装 Node.js 24+，无需安装第三方依赖：

```sh
npm test
```

生成两枚独立的开发令牌，每次运行会生成不同值：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

在三个终端设置环境变量。macOS/Linux 使用 `export NAME=value`；PowerShell 使用 `$env:NAME='value'`。令牌不要放进 Git 或 URL。

1. 中继终端：设置 `GAMEPULSE_PUBLISHER_TOKEN` 与 `GAMEPULSE_RECEIVER_TOKEN`，运行 `npm run relay`。
2. 接收终端：设置相同的 `GAMEPULSE_RECEIVER_TOKEN`，运行 `npm run receive`。
3. 模拟电脑端：设置相同的 `GAMEPULSE_PUBLISHER_TOKEN`，运行 `npm run demo`。

接收终端会显示“匹配成功（模拟）”。这条链路在同一台电脑上运行，默认地址 `127.0.0.1:8787`，还不是手机后台提醒。停止进程使用 Ctrl+C。如果端口被占用，可为中继设置 `PORT=18787`，为两个示例设置 `GAMEPULSE_RELAY_URL=http://127.0.0.1:18787`。远程地址仅接受 HTTPS，当前中继仍需自行配置 TLS 代理和发布前的安全措施。

## 架构

`识别适配器 → MatchMonitor → 协议事件 → 中继 → 接收/推送适配器`

- 连续高置信信号确认，每轮匹配仅生成一次提醒。
- 版本化元数据协议，分离发布与接收凭证，限制容量并去重。
- 自动测试覆盖状态机、协议拒绝、鉴权、重复投递、过期与完整 HTTP 链路。
- GitHub Actions 在 Linux、Windows、macOS 上执行测试。

完整目录、接口与后续实施步骤见 [架构文档](docs/architecture.md)。开发约定见 [CONTRIBUTING](CONTRIBUTING.md)。MIT License。
