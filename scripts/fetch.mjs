#!/usr/bin/env node
/* fetch.mjs —— 抓取当天快照并落盘 + 双向校验
 *
 * 用法：node scripts/fetch.mjs [--force] [--close] [--json] [--wait-login=秒]
 * 退出码：0 成功　1 失败　3 今天已抓过　4 需要用户先登录
 *
 * --json 会在最后多打一行 @@RESULT@@{...}，给上层（MCP / Agent）读。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ensureBrowser, PORT } from "./browser.mjs";
import { RAW, COLLECT_JS, ensureDataDir } from "./paths.mjs";
import { listPages, newPage, closePage, evaluate, waitForLoad } from "./cdp.mjs";

const SITE = "creator.douyin.com";
const MANAGE_URL = `https://${SITE}/creator-micro/content/manage`;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.slice(n.length + 3);
};

const force = flag("--force");
const closeAfter = flag("--close");
const asJson = flag("--json");
// 等登录的秒数。CLI 默认等 6 分钟；MCP 会传 0 —— 让 Agent 立刻拿到「要扫码」这个事实，
// 而不是把一个工具调用卡住几分钟。
const waitLoginSec = Number(opt("wait-login", 360));

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const RESULT = { ok: false, code: 1, capture_date: ymd() };
const finish = (code, extra = {}) => {
  Object.assign(RESULT, extra, { code });
  if (asJson) console.log("@@RESULT@@" + JSON.stringify(RESULT));
  process.exitCode = code;
};

let current = null;

/** 未登录时接口返回的是 HTTP 200 + status_code 8，只看 HTTP 状态码会误判成「没作品」 */
async function checkLogin() {
  try {
    return await evaluate(
      PORT,
      current.id,
      `(async () => {
         try {
           const r = await fetch("/web/api/media/user/info/", { credentials: "include" });
           if (r.status !== 200) return "HTTP " + r.status;
           const j = await r.json();
           if (j.status_code === 8) return "NOLOGIN";
           if (j.status_code !== 0) return "CODE" + j.status_code;
           return "OK:" + ((j.user && j.user.nickname) || "");
         } catch (e) { return "ERR:" + e; }
       })()`,
      { awaitPromise: true, timeoutMs: 20000 }
    );
  } catch (e) {
    return "ERR:" + e.message;
  }
}

const LOGIN_HELP = [
  "需要你先登录一次抖音创作者中心。",
  "浏览器窗口已经打开在登录页，用抖音 App 扫码即可。",
  "登录状态存在专用浏览器目录里，以后不用再登。",
  "这一步机器代替不了，也不该代替。",
];

async function main() {
  ensureDataDir();
  const today = ymd();
  const outFile = path.join(RAW, `${today}.json`);
  const shaFile = path.join(RAW, `${today}.sha16`);

  // ---- 0. 今天是否已经抓过 -------------------------------------------
  if (fs.existsSync(outFile) && !force) {
    log(`⏭  今天（${today}）已经抓过：raw/${today}.json`);
    log("   要重抓加 --force（重抓只会用新数据覆盖当天，不会动其它日期）");
    return finish(3, { skipped: true, message: `今天（${today}）已经抓过，无需重抓` });
  }

  // ---- 1. 确保浏览器在调试模式下跑着 ---------------------------------
  const b = await ensureBrowser({ url: MANAGE_URL });
  if (!b.ok) {
    RESULT.message = b.reason;
    return finish(1);
  }
  log(b.started
    ? `→ 已启动浏览器（${b.browser.name}，调试端口 ${PORT}）`
    : `→ 复用已开着的浏览器（调试端口 ${PORT}）`);

  // ---- 2. 找到或新建后台标签页 ---------------------------------------
  const pages = await listPages(PORT);
  current = pages.find((p) => (p.url || "").includes(SITE)) || null;
  if (!current) {
    log("→ 没有打开着的创作者后台，正在新开一个标签页…");
    const p = await newPage(PORT, MANAGE_URL);
    current = { id: p.id, url: MANAGE_URL };
    await waitForLoad(PORT, current.id);
  }
  log(`→ 页面：${current.url}`);

  // 浏览器刚被拉起来时，页面还在加载、后台接口也没就绪，
  // 这时去取数会拿到一次空列表。等它稳一下再开始。
  if (b.started) {
    log("→ 浏览器是刚启动的，等它就绪…");
    await waitForLoad(PORT, current.id, 30000);
    await sleep(4000);
  }

  // ---- 3. 登录 --------------------------------------------------------
  let status = await checkLogin();
  if (!String(status).startsWith("OK:")) {
    const rounds = Math.max(0, Math.ceil(waitLoginSec / 3));
    if (rounds === 0) {
      LOGIN_HELP.forEach((l) => log(l));
      return finish(4, {
        needs_login: true,
        browser_opened: true,
        login_url: MANAGE_URL,
        message: LOGIN_HELP.join(" "),
      });
    }
    log("");
    log("════════════════════════════════════════════════════");
    LOGIN_HELP.forEach((l) => log("  " + l));
    log("════════════════════════════════════════════════════");
    log("");
    let ok = false;
    for (let i = 0; i < rounds; i++) {
      await sleep(3000);
      status = await checkLogin();
      if (String(status).startsWith("OK:")) { ok = true; break; }
      if (i % 10 === 9) log(`   …还在等扫码（已等 ${(i + 1) * 3} 秒）`);
    }
    if (!ok) {
      return finish(4, {
        needs_login: true,
        browser_opened: true,
        timeout: true,
        login_url: MANAGE_URL,
        message: "等登录超时。本次没有写入任何文件。",
      });
    }
  }
  const nickname = String(status).slice(3);
  log(`✅ 已登录：${nickname || "（昵称未取到）"}`);

  // ---- 4. 执行 collect.js --------------------------------------------
  const collectSrc = fs.readFileSync(COLLECT_JS, "utf8");
  log("→ 开始取数（作品清单 + 深度指标，约 10~40 秒）…");
  await evaluate(PORT, current.id, collectSrc, { awaitPromise: false, timeoutMs: 20000 });

  // ---- 5. 轮询状态 ----------------------------------------------------
  let st = null;
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const raw = await evaluate(PORT, current.id, "JSON.stringify(window.__DY_STATUS__||{state:'NOT_STARTED'})");
    st = JSON.parse(raw);
    if (st.state === "DONE" || st.state === "ERROR") break;
    if (st.state === "NOT_STARTED") {
      RESULT.message = "寄存区是空的（页面可能被刷新过）。重跑一次即可。";
      return finish(1);
    }
    log(`   … ${st.state}  已取 ${st.done || 0} 条  ${st.note || ""}`);
  }
  if (!st || st.state !== "DONE") {
    return finish(1, {
      state: st?.state || null,
      error: st?.error || null,
      message: `取数未成功：${st?.state} ${st?.error || ""}。没有写入任何文件。`,
    });
  }

  // ---- 6. 把数据原样拉出来落盘（不经过任何人工转录）--------------------
  const data = await evaluate(PORT, current.id, "window.__DY__", { timeoutMs: 120000 });
  if (typeof data !== "string" || data.length < 10) {
    RESULT.message = "取回的数据为空，未写入文件。";
    return finish(1);
  }
  fs.writeFileSync(outFile, data, "utf8");

  // ---- 7. 双向校验：本机算 vs 页面记录 --------------------------------
  const localSha = crypto.createHash("sha256").update(Buffer.from(data, "utf8")).digest("hex").slice(0, 16);
  const localBytes = Buffer.byteLength(data, "utf8");
  const pageSha = await evaluate(PORT, current.id, "window.__DY_SHA16__");
  const verified = localSha === pageSha && localBytes === st.bytes;
  fs.writeFileSync(shaFile, `${localSha}  ${localBytes}\n`, "utf8");

  const snap = JSON.parse(data);
  const n = snap.records.length;
  const matched = snap.records.filter((r) => r.metrics_asof).length;

  log("");
  log(`   页面校验码 ${pageSha}   本机校验码 ${localSha}`);
  log(`   页面字节数 ${st.bytes}   本机字节数 ${localBytes}`);

  if (!verified) {
    log("❌ 校验不一致 —— 数据在路上被改动了。本次不并表，请重跑 fetch.mjs --force。");
    return finish(1, {
      verified: false,
      page_sha16: pageSha,
      local_sha16: localSha,
      message: "校验不一致，数据可能被改动，未并表。请重跑。",
    });
  }

  log(`✅ 校验通过：${n} 条作品已落盘 raw/${today}.json`);
  log(`   深度指标覆盖 ${matched}/${n} 条${matched < n ? "（详见 merge 的提示）" : ""}`);
  log("");
  log("下一步：node scripts/merge.mjs");

  finish(0, {
    ok: true,
    verified: true,
    capture_date: today,
    snapshot: `raw/${today}.json`,
    sha16: localSha,
    bytes: localBytes,
    records: n,
    deep_metrics: matched,
    deep_missing: n - matched,
    deep_missing_image: snap.records.filter((r) => !r.metrics_asof && r.media_type === "图文").length,
    account: (snap._meta.account || {}).nickname || nickname || null,
    message: `已抓取 ${n} 条作品，校验通过`,
  });

  // 默认留着标签页：下次直接复用，不用重新开
  if (closeAfter) await closePage(PORT, current.id);
}

main().catch((e) => {
  console.error("❌ " + e.message);
  RESULT.message = e.message;
  if (asJson) console.log("@@RESULT@@" + JSON.stringify(RESULT));
  process.exitCode = 1;
});
