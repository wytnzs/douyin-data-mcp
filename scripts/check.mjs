#!/usr/bin/env node
/* check.mjs —— 环境自检：逐项确认跑得起来，缺什么就说什么、并给出确切的下一步
 *
 * 用法：
 *   node scripts/check.mjs            只检查，不改动任何东西
 *   node scripts/check.mjs --launch   缺浏览器时顺手把专用浏览器启动起来
 *
 * 退出码：0 全部就绪　1 有缺项
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBrowser, findBrowser, browserReady, PORT, PROFILE_DIR } from "./browser.mjs";
import { listPages, newPage, evaluate, closePage, waitForLoad } from "./cdp.mjs";
import { DATA_DIR, RAW, ensureDataDir, whereIsData } from "./paths.mjs";

const SITE = "creator.douyin.com";
const MANAGE_URL = `https://${SITE}/creator-micro/content/manage`;
const shouldLaunch = process.argv.includes("--launch");
const NL = String.fromCharCode(10);

const rows = [];
const add = (ok, name, detail, fix) => rows.push({ ok, name, detail, fix });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ---- 1. Node 版本 --------------------------------------------------
  const major = Number(process.versions.node.split(".")[0]);
  add(
    major >= 22,
    "Node.js 22 以上",
    `当前 v${process.versions.node}`,
    "到 https://nodejs.org 下载 LTS 版装上，装完重开终端"
  );

  // ---- 2. 有没有 Chromium 系浏览器 ------------------------------------
  const browser = findBrowser();
  add(
    !!browser,
    "Chrome / Edge 浏览器",
    browser ? `找到 ${browser.name}` : "没找到",
    "装一个 Chrome 或 Edge 就行"
  );

  // ---- 3. 浏览器是否在调试模式 ----------------------------------------
  let ready = await browserReady();
  if (!ready && shouldLaunch && browser) {
    process.stdout.write("   正在启动专用浏览器…" + NL);
    const b = await ensureBrowser({ url: MANAGE_URL });
    ready = b.ok ? await browserReady() : null;
    if (b.ok) await sleep(2500);
  }
  add(
    !!ready,
    "浏览器调试模式",
    ready ? `端口 ${PORT} 已就绪` : `端口 ${PORT} 没通`,
    "运行 node scripts/check.mjs --launch 自动启动（会新开一个专用浏览器窗口）"
  );

  // ---- 4. 登录状态 ----------------------------------------------------
  let loginMsg = "跳过（浏览器还没就绪）";
  let loggedIn = false;
  let pageId = null;
  if (ready) {
    try {
      const pages = await listPages(PORT);
      let page = pages.find((p) => (p.url || "").includes(SITE));
      if (!page) {
        const p = await newPage(PORT, MANAGE_URL);
        pageId = p.id;
        await waitForLoad(PORT, pageId);
      } else {
        pageId = page.id;
      }
      const r = await evaluate(
        PORT,
        pageId,
        `fetch("/web/api/media/user/info/",{credentials:"include"})
           .then(r=>r.json())
           .then(j=>JSON.stringify({code:j.status_code,name:(j.user&&j.user.nickname)||""}))
           .catch(e=>JSON.stringify({code:-1,name:String(e)}))`,
        { awaitPromise: true, timeoutMs: 20000 }
      );
      const j = JSON.parse(r);
      if (j.code === 0) { loggedIn = true; loginMsg = `已登录：${j.name || "（昵称未取到）"}`; }
      else if (j.code === 8) loginMsg = "未登录";
      else loginMsg = `异常 status_code=${j.code}`;
    } catch (e) {
      loginMsg = "检查失败：" + e.message;
    }
  }
  add(
    loggedIn,
    "抖音创作者中心登录",
    loginMsg,
    `在专用浏览器窗口里打开 ${MANAGE_URL} 扫码登录一次（以后免登）`
  );

  // ---- 5. 数据目录可写 -------------------------------------------------
  let writable = true;
  let writeMsg = "可写";
  try {
    ensureDataDir();
    const probe = path.join(RAW, ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
  } catch (e) {
    writable = false;
    writeMsg = "不可写：" + e.message;
  }
  add(writable, "数据目录可写", writeMsg, "检查这个目录的权限：" + DATA_DIR);

  // ---- 输出 -----------------------------------------------------------
  console.log("");
  console.log("环境自检" + NL);
  for (const r of rows) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.name} — ${r.detail}`);
  }
  const bad = rows.filter((r) => !r.ok);

  console.log("");
  if (!bad.length) {
    console.log("全部就绪。下一步：" + NL);
    console.log("  node scripts/daily.mjs        # 抓今天的 + 并表 + 出总览");
  } else {
    console.log("还差这几项，按顺序处理：" + NL);
    bad.forEach((r, i) => console.log(`  ${i + 1}. ${r.name}：${r.fix}`));
    console.log("");
    console.log("处理完再跑一次：node scripts/check.mjs");
  }
  console.log("");
  console.log(`专用浏览器目录：${PROFILE_DIR}`);
  console.log("（登录状态存在这里。删掉它就要重新扫码，但不会影响你日常用的浏览器。）");

  if (pageId && !loggedIn) {
    console.log("");
    console.log("提示：浏览器窗口已开着登录页，扫完码直接重跑 check.mjs 就行。");
  }
  if (pageId && loggedIn && shouldLaunch) await closePage(PORT, pageId);

  process.exitCode = bad.length ? 1 : 0;
}

main().catch((e) => {
  console.error("自检本身出错了：" + e.message);
  process.exitCode = 1;
});
