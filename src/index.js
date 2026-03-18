import puppeteer from '@cloudflare/puppeteer';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendTelegramMessage(token, chatId, text) {
  if (!token || !chatId) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
  } catch (err) { console.error("TG推送失败:", err); }
}

async function sendBarkMessage(deviceKeysStr, text) {
  if (!deviceKeysStr) return;
  const deviceKeys = deviceKeysStr.split(',').map(k => k.trim()).filter(k => k.length > 0);
  try {
    await fetch("https://api.day.app/push", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ title: "兑换码助手", body: text, sound: "minuet", device_keys: deviceKeys })
    });
  } catch (err) { console.error("Bark推送失败:", err); }
}

export default {
  async fetch(request, env, ctx) {
    ctx.waitUntil(this.mainTask(env));
    return new Response("任务已手动触发，请观察日志输出。", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    await this.mainTask(env);
  },

  async mainTask(env) {
    const roles = [
      '1689884746462003279', '1689886064172990864', '1689883572086505877',
      '3378734910823596534', '3378737564458418452', '3378738710698527412',
      '3378736884166688907', '3378737194142532460', '3378743358561714268',
      '3378738710740994744', '3378745454444285196', '3378746664942698821',
      '1689897753946882073'
    ];

    let fetchedCodes = [];
    let browser;

    try {
      browser = await puppeteer.launch(env.MYBROWSER);
      const page = await browser.newPage();

      // 【关键优化 1】：设置伪装 User-Agent，防止 B 站拦截无头浏览器
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

      // 访问页面
      console.log("正在访问 Wiki 页面...");
      await page.goto('https://wiki.biligame.com/langrisser/兑换码', { 
        waitUntil: 'networkidle2', // 等待网络空闲
        timeout: 60000 
      });

      // 【关键优化 2】：不仅等待选择器，还要额外休眠几秒确保 Wiki 脚本执行完毕
      console.log("等待兑换码组件加载...");
      try {
        await page.waitForSelector('.cdkey-tr', { timeout: 20000 });
        await sleep(3000); // 额外给 3 秒缓冲区
      } catch (e) {
        console.error("未发现 .cdkey-tr 元素，可能是 Wiki 结构变动或加载极慢。");
      }

      // 【关键优化 3】：增强的提取脚本
      fetchedCodes = await page.evaluate(() => {
        const results = [];
        const rows = document.querySelectorAll('.cdkey-tr');
        
        rows.forEach(row => {
          const statusBtn = row.querySelector('.cdkey-acti');
          // 这里的文本判断增加“包含”逻辑，防止有隐形字符
          if (statusBtn && statusBtn.innerText.includes('领取')) {
            const codeEl = row.querySelector('.bikited-copy');
            if (codeEl) {
              // 优先取 innerText，如果为空则尝试取 data-code 属性（Wiki 常用套路）
              let codeValue = codeEl.innerText.trim();
              if (!codeValue) {
                codeValue = codeEl.getAttribute('data-clipboard-text') || codeEl.getAttribute('data-code');
              }
              if (codeValue) results.push(codeValue);
            }
          }
        });
        return results;
      });

      console.log(`[抓取结果] 找到 ${fetchedCodes.length} 个可用码:`, fetchedCodes);

    } catch (err) {
      console.error("浏览器运行错误:", err.message);
      return;
    } finally {
      if (browser) await browser.close();
    }

    // 后续的比对和兑换逻辑保持不变...
    if (fetchedCodes.length === 0) return;

    let usedCodesSet = new Set();
    try {
      const historyStr = await env.CODE_HISTORY.get("used_codes");
      if (historyStr) usedCodesSet = new Set(JSON.parse(historyStr));
    } catch (err) {}

    const fresh_codes = fetchedCodes.filter(code => !usedCodesSet.has(code));
    if (fresh_codes.length === 0) return;

    let newly_used = new Set();
    let notify_msgs = [];

    for (const code of fresh_codes) {
      console.log(`>>> 处理新码: ${code}`);
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
          const data = await response.json();
          if (data.info === 115) {
            notify_msgs.push(`🎁 成功：${code} (角色:${role})`);
          }
        } catch (e) {}
        await sleep(1000); 
      }
      newly_used.add(code);
    }

    if (newly_used.size > 0) {
      newly_used.forEach(c => usedCodesSet.add(c));
      await env.CODE_HISTORY.put("used_codes", JSON.stringify(Array.from(usedCodesSet)));
      if (notify_msgs.length > 0) {
        const msg = "*🎮 梦幻模拟战兑换报告*\n\n" + notify_msgs.join("\n");
        await Promise.all([
          sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg),
          sendBarkMessage(env.BARK_DEVICE_KEYS, msg)
        ]);
      }
    }
  }
};
