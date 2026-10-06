#!/usr/bin/env node
/* mcp.mjs —— 零依赖的 MCP server，把抖音数据抓取能力直接暴露给 Agent
 *
 * 兼容两种协议年代：
 *   - modern：server/discover + 每请求 _meta 带版本（2026-07-28 起）
 *   - legacy：initialize 握手（2025-11-25 及更早，目前大多数客户端）
 *
 * 传输：stdio，换行分隔的 JSON-RPC 2.0。
 * 纪律：stdout 只写协议消息，任何日志都走 stderr。写脏 stdout 会直接把协议搞坏。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR, RAW, CSV, LOG, SCRIPTS_DIR } from "./paths.mjs";
import { browserReady, PORT, PROFILE_DIR } from "./browser.mjs";
import { listPages, evaluate } from "./cdp.mjs";
import { parseCsv, toObjects } from "./csv.mjs";
import { toKey } from "./columns.mjs";

const SITE = "creator.douyin.com";
const MANAGE_URL = `https://${SITE}/creator-micro/content/manage`;

const SERVER_INFO = { name: "douyin-data", version: "1.0.0" };
const SUPPORTED_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const FALLBACK_VERSION = "2025-06-18";

const say = (...a) => process.stderr.write(a.join(" ") + "\n");
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

// ---------------------------------------------------------------- 工具实现

const ymd = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 跑一个 CLI 子进程，取回退出码和 stdout/stderr；顺带把 @@RESULT@@ 那行解出来 */
function runCli(script, args = [], { timeoutMs = 900000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, script), ...args], {
      cwd: SCRIPTS_DIR,
      windowsHide: true,
    });
    let out = "", err = "";
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      let result = null;
      const m = out.match(/@@RESULT@@(.*)/);
      if (m) { try { result = JSON.parse(m[1]); } catch {} }
      const text = out.replace(/@@RESULT@@.*\n?/g, "").trim();
      resolve({ code, result, stdout: text, stderr: err.trim() });
    });
  });
}

/** 登录状态 + 浏览器状态。只探测，不启动任何东西。 */
async function envState() {
  const ready = await browserReady();
  if (!ready) {
    return { browser_running: false, logged_in: false, account: null, note: "专用浏览器没在调试模式下运行" };
  }
  try {
    const pages = await listPages(PORT);
    const page = pages.find((p) => (p.url || "").includes(SITE));
    if (!page) return { browser_running: true, logged_in: false, account: null, note: "没有打开着的创作者后台页面" };
    const r = await evaluate(
      PORT,
      page.id,
      `fetch("/web/api/media/user/info/",{credentials:"include"})
         .then(r=>r.json())
         .then(j=>JSON.stringify({code:j.status_code,name:(j.user&&j.user.nickname)||""}))
         .catch(e=>JSON.stringify({code:-1,name:String(e)}))`,
      { awaitPromise: true, timeoutMs: 20000 }
    );
    const j = JSON.parse(r);
    return {
      browser_running: true,
      logged_in: j.code === 0,
      account: j.code === 0 ? j.name || null : null,
      note: j.code === 0 ? "已登录" : j.code === 8 ? "未登录（需要用户扫码）" : `异常 status_code=${j.code}`,
    };
  } catch (e) {
    return { browser_running: true, logged_in: false, account: null, note: "探测失败：" + e.message };
  }
}

function readCsv() {
  if (!fs.existsSync(CSV)) return { header: [], rows: [] };
  const { header, rows } = parseCsv(fs.readFileSync(CSV, "utf8"));
  const keys = header.map(toKey);   // 中文表头也认，认成内部 key
  return { header: keys, rows: toObjects(keys, rows) };
}

function dataState() {
  const today = ymd();
  const { rows } = readCsv();
  const dates = [...new Set(rows.map((r) => r.capture_date))].sort();
  let lastMerge = null;
  try {
    const files = fs.readdirSync(RAW).filter((f) => /^\d{4}-\d{2}-\d{2}\.merge\.json$/.test(f)).sort();
    if (files.length) lastMerge = JSON.parse(fs.readFileSync(path.join(RAW, files[files.length - 1]), "utf8"));
  } catch {}
  return {
    today,
    fetched_today: fs.existsSync(path.join(RAW, `${today}.json`)),
    total_rows: rows.length,
    capture_dates: dates.length,
    first_capture: dates[0] || null,
    last_capture: dates[dates.length - 1] || null,
    last_run: lastMerge,
  };
}

const TOOLS = [
  {
    name: "douyin_status",
    description:
      "查抖音数据抓取的当前状态：专用浏览器有没有跑、抖音有没有登录（以及登录的是哪个账号）、今天抓过没有、总表累计多少行。只读，不启动任何东西、不改任何数据。任何时候都可以先调这个。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => {
      const [env, data] = [await envState(), dataState()];
      const lines = [
        `浏览器：${env.browser_running ? "在跑" : "没在跑"} · 登录：${env.logged_in ? `是（${env.account || "昵称未取到"}）` : "否"}${env.note ? ` · ${env.note}` : ""}`,
        `今天（${data.today}）：${data.fetched_today ? "已抓过" : "还没抓"}`,
        `总表：累计 ${data.total_rows} 行，覆盖 ${data.capture_dates} 个抓取日${data.first_capture ? `（${data.first_capture} ~ ${data.last_capture}）` : ""}`,
      ];
      if (data.last_run) {
        lines.push(
          `最近一次：${data.last_run.capture_date} 取 ${data.last_run.count} 条，新增 ${data.last_run.added} / 更新 ${data.last_run.updated}，当日总播放 ${data.last_run.total_view}`
        );
      }
      return { text: lines.join("\n"), data: { env, data } };
    },
  },
  {
    name: "douyin_check",
    description:
      "抖音抓取环境自检：Node 版本、有没有浏览器、浏览器调试端口通不通、抖音登录了没、数据目录可写不。launch=true 时会顺手把专用浏览器启动起来（会弹出窗口）。返回逐项 ✅/❌ 和缺项的修复办法。",
    inputSchema: {
      type: "object",
      properties: { launch: { type: "boolean", description: "缺浏览器时是否自动启动（默认 false）" } },
      additionalProperties: false,
    },
    handler: async ({ launch } = {}) => {
      const r = await runCli("check.mjs", launch ? ["--launch"] : [], { timeoutMs: 180000 });
      return { text: r.stdout || r.stderr, extra: { exit_code: r.code }, isError: r.code !== 0 };
    },
  },
  {
    name: "douyin_fetch",
    description:
      "抓取抖音后台数据并落盘（当天快照 + 双向校验），但【不并进总表】。抓完必须看返回的 verified 字段：true 才说明两端校验码一致、数据可信。返回 needs_login=true 时，说明需要用户本人去浏览器窗口扫码，扫完再调一次即可——不要试图替用户登录。",
    inputSchema: {
      type: "object",
      properties: {
        force: { type: "boolean", description: "今天已经抓过时是否强制重抓（默认 false，会直接跳过）" },
        wait_for_login_seconds: {
          type: "number",
          description: "未登录时等用户扫码的秒数。默认 0 = 立刻返回 needs_login，让用户去扫。",
        },
      },
      additionalProperties: false,
    },
    handler: async ({ force, wait_for_login_seconds } = {}) => {
      const args = ["--json", `--wait-login=${Number(wait_for_login_seconds) || 0}`];
      if (force) args.push("--force");
      const r = await runCli("fetch.mjs", args);
      const res = r.result || {};
      const lines = [];
      if (res.needs_login) {
        lines.push("⚠️ 需要用户先登录抖音创作者中心。");
        lines.push("浏览器窗口已经打开在登录页，请让用户用抖音 App 扫码。");
        lines.push("扫完再调一次 douyin_fetch 即可。");
      } else if (res.skipped) {
        lines.push(`今天（${res.capture_date}）已经抓过了，跳过了。要重抓就传 force=true。`);
      } else if (res.verified) {
        lines.push(`✅ 抓取成功，校验通过：${res.records} 条作品。`);
        lines.push(`账号：${res.account || "未知"}　校验码：${res.sha16}　字节数：${res.bytes}`);
        lines.push(`深度指标覆盖 ${res.deep_metrics}/${res.records} 条${res.deep_missing ? `（缺 ${res.deep_missing} 条，其中图文作品 ${res.deep_missing_image} 条）` : ""}`);
      } else {
        lines.push("❌ 抓取失败：" + (res.message || r.stderr || "未知原因"));
      }
      return { text: lines.join("\n"), data: res, extra: { exit_code: r.code, log: r.stdout }, isError: r.code !== 0 && r.code !== 3 };
    },
  },
  {
    name: "douyin_merge",
    description:
      "把最近一次（或指定的）快照并进总表 抖音作品数据.csv，并重新生成《抖音数据总览.md》。主键是「抓取日期 + 作品ID」，同一天重抓是覆盖，不会重复也不会动其它日期。",
    inputSchema: {
      type: "object",
      properties: { snapshot: { type: "string", description: "可选，指定 raw/ 下的快照文件名；不传就用最新一份" } },
      additionalProperties: false,
    },
    handler: async ({ snapshot } = {}) => {
      const r = await runCli("merge.mjs", ["--json", ...(snapshot ? [snapshot] : [])]);
      const res = r.result || {};
      if (res.ok) await runCli("report.mjs", [], { timeoutMs: 120000 });
      const lines = res.ok
        ? [
            `✅ 已并表：${res.capture_date}　本次 ${res.count} 条（新增 ${res.added} / 更新 ${res.updated}）`,
            `累计 ${res.total_rows} 行，当日总播放 ${res.total_view}`,
            res.no_deep ? `深度指标 ${res.deep_matched}/${res.count} 条（缺的里面图文作品 ${res.no_deep_image} 条、当天刚发 ${res.no_deep_fresh} 条）` : "深度指标齐全",
            res.anomalies?.length ? `⚠️ 指标异常：${res.anomalies.join("；")}` : "",
            "《抖音数据总览.md》已同步更新。",
          ].filter(Boolean)
        : ["❌ 并表失败：" + (r.stderr || "未知原因")];
      return { text: lines.join("\n"), data: res, extra: { exit_code: r.code }, isError: !res.ok };
    },
  },
  {
    name: "douyin_daily",
    description:
      "一条命令做完一整套：抓取 → 双向校验 → 并表 → 生成总览 → 记日志。校验不过会自动停在取数那步，一个文件都不写。日常就用这个。",
    inputSchema: {
      type: "object",
      properties: { force: { type: "boolean", description: "今天已经抓过时是否强制重抓" } },
      additionalProperties: false,
    },
    handler: async ({ force } = {}) => {
      const args = ["--json", `--wait-login=0`];
      if (force) args.push("--force");
      const r = await runCli("daily.mjs", args);
      const res = r.result || {};
      let lines;
      let isError = r.code !== 0;
      if (r.code === 3) {
        // 「今天已经抓过」是正常状态，不是失败 —— 别让 Agent 误判
        lines = [`今天（${res.capture_date || "今天"}）已经抓过了，没有新东西要并。要强制重抓就传 force=true。`];
        isError = false;
      } else if (res.needs_login) {
        lines = ["⚠️ 需要用户先登录，请让用户在弹出的浏览器窗口扫码，然后重跑。"];
      } else if (r.code === 0) {
        lines = ["✅ 全流程完成（抓取 → 校验 → 并表 → 总览 → 日志）。", "详见《抖音数据总览.md》和《抓取状态.md》。"];
      } else {
        lines = ["❌ 未完成：" + (res.message || r.stderr || "未知原因")];
      }
      return { text: lines.join("\n"), data: res, extra: { exit_code: r.code, log: r.stdout }, isError };
    },
  },
  {
    name: "douyin_data",
    description:
      "读总表 抖音作品数据.csv 里的作品数据，用来做复盘和分析。可按抓取日期筛选、按播放量排序、限制条数。返回结构化行数据。",
    inputSchema: {
      type: "object",
      properties: {
        capture_date: { type: "string", description: "抓取日期 YYYY-MM-DD，默认取最新的那批" },
        limit: { type: "number", description: "最多返回几条，默认 20" },
        sort_by: { type: "string", enum: ["view", "publish_date"], description: "排序字段，默认按播放量降序" },
      },
      additionalProperties: false,
    },
    handler: async ({ capture_date, limit, sort_by } = {}) => {
      const { rows } = readCsv();
      if (!rows.length) return { text: "总表还是空的，先跑 douyin_daily 抓一次。", isError: false };
      const dates = [...new Set(rows.map((r) => r.capture_date))].sort();
      const d = capture_date || dates[dates.length - 1];
      let sel = rows.filter((r) => r.capture_date === d);
      const n = Math.min(Number(limit) || 20, 500);
      if (sort_by === "publish_date") sel.sort((a, b) => b.publish_date.localeCompare(a.publish_date));
      else sel.sort((a, b) => (Number(b.view) || 0) - (Number(a.view) || 0));
      const total = sel.reduce((s, r) => s + (Number(r.view) || 0), 0);
      const text =
        `${d} 共 ${sel.length} 条，总播放 ${total.toLocaleString("zh-CN")}，返回前 ${Math.min(n, sel.length)} 条：\n` +
        JSON.stringify(sel.slice(0, n), null, 1);
      return { text, data: { capture_date: d, count: sel.length, total_view: total, rows: sel.slice(0, n) } };
    },
  },
];

// ---------------------------------------------------------------- 协议处理

async function handleToolCall(params) {
  const name = params?.name;
  const args = params?.arguments || {};
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    return { content: [{ type: "text", text: `没有这个工具：${name}` }], isError: true };
  }
  try {
    const r = await tool.handler(args);
    const parts = [{ type: "text", text: r.text }];
    // 结构化数据单独一块，Agent 想精确取值时用得上
    if (r.data !== undefined) {
      parts.push({ type: "text", text: "```json\n" + JSON.stringify(r.data, null, 2) + "\n```" });
    }
    const out = { content: parts };
    if (r.isError) out.isError = true;
    return out;
  } catch (e) {
    return { content: [{ type: "text", text: `工具执行出错：${e.message}` }], isError: true };
  }
}

const INSTRUCTIONS = [
  "抖音账号数据抓取。只读用户自己的创作者后台，不发布、不改后台、不代替登录。",
  "推荐流程：先 douyin_status 看状态 → 没登录就 douyin_check(launch=true) 把浏览器开起来、请用户扫码 → douyin_daily 跑完整套。",
  "看到 needs_login 时，务必让用户本人去浏览器窗口扫码，不要尝试绕过。",
  "抓完要如实报告：fetch 的 verified 必须是 true 才算数据可信；为 false 时不要往下并表。",
].join(" ");

async function dispatch(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  // --- modern：能力发现 ---
  if (method === "server/discover") {
    const reqV = params?._meta?.["io.modelcontextprotocol/protocolVersion"];
    return {
      jsonrpc: "2.0", id,
      result: {
        resultType: "complete",
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
        instructions: INSTRUCTIONS,
        ttlMs: 3600000,
        cacheScope: "public",
      },
    };
  }

  // --- legacy：initialize 握手 ---
  if (method === "initialize") {
    const reqV = params?.protocolVersion;
    const v = SUPPORTED_VERSIONS.includes(reqV) ? reqV : FALLBACK_VERSION;
    return {
      jsonrpc: "2.0", id,
      result: { protocolVersion: v, capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS },
    };
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") return null;

  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0", id,
      result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
    };
  }

  if (method === "tools/call") {
    const result = await handleToolCall(params);
    return { jsonrpc: "2.0", id, result };
  }

  if (isNotification) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ---------------------------------------------------------------- stdio 主循环

let buf = "";
let pending = 0;      // 正在处理中的请求数
let stdinClosed = false;
let hardExit = null;  // 兜底定时器

/** 只有在没有请求在跑的时候才退出。
 *  否则客户端一关 stdin（或一次性喂完输入），正在执行的工具调用会被直接掐掉，
 *  响应还没发出去进程就没了。 */
function maybeExit() {
  if (stdinClosed && pending === 0) {
    if (hardExit) clearTimeout(hardExit);
    process.exit(0);
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { say("[mcp] 收到无法解析的行，已忽略"); continue; }
    pending++;
    Promise.resolve()
      .then(() => dispatch(msg))
      .then((res) => { if (res) send(res); })
      .catch((e) => {
        say("[mcp] 处理出错：" + e.message);
        if (msg && msg.id !== undefined && msg.id !== null) {
          send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: e.message } });
        }
      })
      .finally(() => { pending--; maybeExit(); });
  }
});

process.stdin.on("end", () => {
  stdinClosed = true;
  hardExit = setTimeout(() => {
    say("[mcp] 还有 " + pending + " 个请求没跑完，但已经等太久了，强制退出");
    process.exit(0);
  }, 600000);
  maybeExit();
});

say(`[mcp] douyin-data MCP server 已启动　代码 ${SCRIPTS_DIR}　浏览器端口 ${PORT}`);
say(`[mcp] 数据 ${DATA_DIR}`);
 say(`[mcp] 浏览器目录 ${PROFILE_DIR}`);
