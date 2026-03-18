

# 🎮 Langrisser 自动兑换助手 (Cloudflare Worker 版)

这是一个基于 **Cloudflare Workers** 开发的全自动兑换码抓取与兑换工具。它能够每小时自动巡检《梦幻模拟战》B站 Wiki，识别最新可用的兑换码，并为预设的多个角色自动完成 API 兑换，最后通过 **Telegram** 和 **Bark (iOS)** 推送结果。

---

## ✨ 核心功能

| 功能模块 | 说明 |
| :--- | :--- |
| **自动化抓取** | 使用 Cloudflare Browser Rendering (Puppeteer) 模拟无头浏览器访问 Wiki 页面。 |
| **智能比对** | 利用 Cloudflare KV 数据库持久化存储已兑换记录，确保不重复请求。 |
| **多角色支持** | 支持配置无限数量的角色 ID，程序将自动循环为每个角色尝试兑换。 |
| **双渠道通知** | 同时支持 Telegram Bot 和 Bark (iOS) 推送，实时获取兑换成功报告。 |
| **零成本运行** | 完美适配 Cloudflare Free Tier 免费额度，无需支付任何费用。 |

---

## 📂 项目结构

```text
langrisser-code-redeemer/
├── src/
│   └── index.js             # 核心业务逻辑（抓取、兑换、通知）
├── wrangler.toml            # Cloudflare Worker 配置文件
├── package.json             # 项目依赖与脚本配置
├── .gitignore               # Git 忽略配置
└── README.md                # 本说明文档
```

---

## 🚀 快速部署指南

### 1. 环境准备
*   安装 [Node.js](https://nodejs.org/) (推荐 LTS 版本)。
*   在本地终端登录 Cloudflare 账号：
    ```bash
    npx wrangler login
    ```

### 2. 初始化 KV 数据库
在终端执行以下命令创建用于存储历史记录的数据库：
```bash
npx wrangler kv:namespace create CODE_HISTORY
```
**注意：** 执行后终端会输出类似 `id = "xxxxxxxxxxxx"` 的内容，请将其复制并替换到 `wrangler.toml` 中的对应位置。

### 3. 配置文件修改
打开 `wrangler.toml`，确保其包含以下基础配置：
```toml
name = "langrisser-code-redeemer"
main = "src/index.js"
compatibility_date = "2024-03-20"
compatibility_flags = ["nodejs_compat"] # 必须开启，解决 Puppeteer 依赖问题

[triggers]
crons = ["0 * * * *"] # 每小时运行一次

[browser]
binding = "MYBROWSER"

[[kv_namespaces]]
binding = "CODE_HISTORY"
id = "你的_KV_NAMESPACE_ID"
```

### 4. 部署至云端
```bash
npm install
npx wrangler deploy
```

---

## 🔐 关键安全设置 (Secrets)

**重要：** 为了保障隐私安全，请勿将 Token 和 Key 直接写在代码或配置文件中。请在部署完成后，通过以下两种方式之一设置敏感变量：

### 方式 A：通过命令行 (推荐)
在项目根目录依次运行以下命令并按提示输入对应数值：
```bash
# Telegram 机器人 Token
npx wrangler secret put TELEGRAM_BOT_TOKEN

# Telegram 用户/频道 ID
npx wrangler secret put TELEGRAM_CHAT_ID

# Bark 设备 Key (多个用英文逗号分隔)
npx wrangler secret put BARK_DEVICE_KEYS
```

### 方式 B：通过 Cloudflare 网页后台
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 进入 **Workers & Pages** -> 点击本项目 `langrisser-code-redeemer`。
3. 点击 **Settings (设置)** -> **Variables (变量)**。
4. 在 **Environment Variables** 部分点击 **Add Variable**。
5. 添加以下三个变量，并务必点击 **Encrypt (加密)**：
    *   `TELEGRAM_BOT_TOKEN`
    *   `TELEGRAM_CHAT_ID`
    *   `BARK_DEVICE_KEYS`

---

## 🛠️ 如何测试

部署并配置好变量后，你可以通过以下方式立即触发一次任务进行验证：
1. 在浏览器中访问：`https://langrisser-code-redeemer.你的用户名.workers.dev`
2. 打开 Cloudflare 控制台的 **Logs (实时日志)** 页面，查看程序运行过程。

---

## ⚠️ 免责声明
本项目仅供技术研究和学习使用，请勿用于违反游戏服务协议的目的。因使用本项目导致的账号异常或其他损失，开发者不承担任何责任。

---

### 💡 维护说明
由于 B 站 Wiki 的页面结构可能随时间发生变化，如发现无法抓取兑换码，请检查 `src/index.js` 中的 `page.evaluate` 部分的选择器逻辑是否依然有效。
