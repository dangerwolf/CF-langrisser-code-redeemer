import puppeteer from '@cloudflare/puppeteer';

// 辅助函数：休眠防并发
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 辅助函数：发送 Telegram 通知
async function sendTelegramMessage(token, chatId, text) {
  if (!token || !chatId) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });
    console.log("Telegram 通知发送成功！");
  } catch (err) {
    console.error("Telegram 通知发送失败:", err);
  }
}

// 辅助函数：发送 Bark 通知
async function sendBarkMessage(deviceKeysStr, text) {
  if (!deviceKeysStr) return;
  
  // 将环境变量中的字符串按逗号分割成数组，并去除空格
  const deviceKeys = deviceKeysStr.split(',').map(k => k.trim()).filter(k => k.length > 0);
  if (deviceKeys.length === 0) return;

  try {
    await fetch("https://api.day.app/push", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        title: "兑换码自动兑换",
        body: text,
        sound: "minuet",
        group: "梦幻模拟战手游",
        device_keys: deviceKeys // 传入从环境变量解析出的数组
      })
    });
    console.log("Bark 通知发送成功！");
  } catch (err) {
    console.error("Bark 通知发送失败:", err);
  }
}

export default {
  // 手动测试入口
  async fetch(request, env, ctx) {
    ctx.waitUntil(this.mainTask(env));
    return new Response("抓取与兑换任务已在后台启动，请查看 Cloudflare 日志！", { status: 200 });
  },

  // Cron 定时任务入口
  async scheduled(event, env, ctx) {
    await this.mainTask(env);
  },

  async mainTask(env) {
    // 1. 角色列表配置
    const roles = [
      '1689884746462003279', '1689886064172990864', '1689883572086505877',
      '3378734910823596534', '3378737564458418452', '3378738710698527412',
      '3378736884166688907', '3378737194142532460', '3378743358561714268',
      '3378738710740994744', '3378745454444285196', '3378746664942698821',
      '1689897753946882073'
    ];

    console.log("任务开始：准备抓取 B站 Wiki 兑换码...");
    let fetchedCodes = [];
    let browser;

    // 2. 无头浏览器抓取环节
    try {
      browser = await puppeteer.launch(env.MYBROWSER);
      const page = await browser.newPage();
      await page.goto('https://wiki.biligame.com/langrisser/兑换码', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.cdkey-tr', { timeout: 30000 });

      fetchedCodes = await page.evaluate(() => {
        const codeArray = [];
        const rows = document.querySelectorAll('.cdkey-tr');
        for (const row of rows) {
          try {
            const statusEl = row.querySelector('.cdkey-acti');
            if (statusEl && statusEl.innerText.trim() === '领取') {
              const codeEl = row.querySelector('.bikited-copy');
              if (codeEl) codeArray.push(codeEl.innerText.trim());
            }
          } catch (e) { continue; }
        }
        return codeArray;
      });
      console.log(`网页提取完成，找到 ${fetchedCodes.length} 个兑换码。`);
    } catch (err) {
      console.error("Puppeteer 抓取异常:", err);
      return; 
    } finally {
      if (browser) await browser.close(); 
    }

    if (fetchedCodes.length === 0) return;

    // 3. 读取 KV 历史记录
    let usedCodesSet = new Set();
    try {
      const historyStr = await env.CODE_HISTORY.get("used_codes");
      if (historyStr) usedCodesSet = new Set(JSON.parse(historyStr));
    } catch (err) {}

    // 4. 找出新码
    const fresh_codes = fetchedCodes.filter(code => !usedCodesSet.has(code));
    if (fresh_codes.length === 0) {
      console.log("没有检测到新码，任务结束。");
      return;
    }

    // 5. 遍历新码并进行 API 兑换
    let newly_used = new Set();
    let notify_msgs = [];

    for (const code of fresh_codes) {
      let code_success = false;

      for (const role of roles) {
        const serverId = role.startsWith('33787') ? "6001" : "3001";
        const params = new URLSearchParams();
        params.append("appkey", "1486458782785");
        params.append("card_user", role);
        params.append("card_channel", "0123456789");
        params.append("card_server", serverId);
        params.append("card_role", role);
        params.append("card_code", code);
        params.append("type", "2");

        try {
          const response = await fetch("https://activity.zlongame.com/activity/cmn/card/csmweb.do", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
            body: params.toString()
          });

          if (response.status === 200) {
            const data = await response.json();
            if (data.info === 115) { // 115 代表成功
              console.log(`[成功] ${role} 兑换 ${code}`);
              notify_msgs.push(`🎁 成功兑换码：${code} | 角色ID：${role}`);
              code_success = true;
            } else {
              console.log(`[反馈] ${role} 兑换 ${code} => info: ${data.info}`);
            }
          }
        } catch (error) {
          console.error(`[异常] ${role} 请求出错:`, error.message);
        }
        await sleep(1000); 
      }
      // 不论成败均记录，防止未来 1 小时重复发起请求
      newly_used.add(code);
    }

    // 6. 保存状态并发送多渠道通知
    if (newly_used.size > 0) {
      newly_used.forEach(code => usedCodesSet.add(code));
      await env.CODE_HISTORY.put("used_codes", JSON.stringify(Array.from(usedCodesSet)));
      
      if (notify_msgs.length > 0) {
        const tgMessage = "*🎮 Langrisser 自动兑换通知*\n\n" + notify_msgs.join("\n\n");
        const barkMessage = notify_msgs.join("\n"); // Bark 不支持复杂 Markdown，用纯文本换行
        
        // 并行触发两种推送
        await Promise.all([
          sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, tgMessage),
          sendBarkMessage(env.BARK_DEVICE_KEYS, barkMessage)
        ]);
      } else {
        console.log("所有尝试兑换的码均无效或已兑换过，无成功记录，不发送通知。");
      }
    }
  }
};
