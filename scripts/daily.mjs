#!/usr/bin/env node
/* daily.mjs —— 一条命令跑完：取数 → 校验 → 并表 → 出总览 → 记日志
 *
 * 用法：node scripts/daily.mjs [--force] [--json] [--wait-login=秒]
 * 退出码：0 成功　1 失败　3 今天已抓过　4 需要用户先登录
 *
 * 校验不过就停在取数那步，一个文件都不写，更不会并表。
 * 今天已经抓过则直接跳过，不重复记日志。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { RAW, LOG, SCRIPTS_DIR } from "./paths.mjs";

const NL = String.fromCharCode(10);

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const asJson = argv.includes("--json");
const waitLogin = (() => {
  const hit = argv.find((a) => a.startsWith("--wait-login="));
  return hit ? hit.slice("--wait-login=".length) : "360";
})();

const RESULT = { ok: false, code: 1, stage: null };
const finish = (code, extra = {}) => {
  Object.assign(RESULT, extra, { code });
  if (asJson) console.log("@@RESULT@@" + JSON.stringify(RESULT));
  process.exitCode = code;
};

/** 跑子步骤；把子进程自己的 @@RESULT@@ 收走，原样打印其余输出 */
function run(script, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, script), ...args], {
      cwd: SCRIPTS_DIR,
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", (code) => {
      let result = null;
      const m = out.match(/@@RESULT@@(.*)/);
      if (m) { try { result = JSON.parse(m[1]); } catch {} }
      const text = out.replace(/@@RESULT@@.*\n?/g, "");
      process.stdout.write(text);
      resolve({ code, result });
    });
  });
}

async function main() {
  // 1. 取数 + 校验
  const fetchArgs = [`--json`, `--wait-login=${waitLogin}`];
  if (force) fetchArgs.push("--force");
  const f = await run("fetch.mjs", fetchArgs);

  if (f.code === 4 || f.result?.needs_login) {
    console.log(`${NL}需要先登录抖音创作者中心，请在弹出的浏览器窗口扫码，然后重跑。`);
    return finish(4, { stage: "fetch", needs_login: true, message: f.result?.message || "需要用户扫码登录" });
  }
  if (f.code === 3) {
    console.log(`${NL}今天已经抓过了，没有新东西要并。强制重抓：node scripts/daily.mjs --force`);
    return finish(3, {
      stage: "fetch",
      skipped: true,
      capture_date: f.result?.capture_date || null,
      message: "今天已经抓过",
    });
  }
  if (f.code !== 0) {
    console.error(`${NL}❌ 取数或校验没通过，已停止：没有并表，没有改任何累计数据。`);
    return finish(1, { stage: "fetch", message: f.result?.message || "取数或校验失败" });
  }

  // 2. 并表
  const m = await run("merge.mjs", ["--json"]);
  if (m.code !== 0) {
    console.error(`${NL}❌ 并表失败。`);
    return finish(1, { stage: "merge", message: "并表失败" });
  }

  // 3. 出总览
  await run("report.mjs");

  // 4. 记日志
  const date = fs
    .readdirSync(RAW)
    .filter((x) => /^\d{4}-\d{2}-\d{2}\.merge\.json$/.test(x))
    .sort()
    .pop()
    .replace(".merge.json", "");
  const sum = JSON.parse(fs.readFileSync(path.join(RAW, `${date}.merge.json`), "utf8"));
  const shaLine = fs.existsSync(path.join(RAW, `${date}.sha16`))
    ? fs.readFileSync(path.join(RAW, `${date}.sha16`), "utf8").trim().split(/\s+/)
    : ["—", "—"];

  const entry = [
    `## ${date}`,
    "",
    `- 本次条数：${sum.count}　新增 ${sum.added} / 更新 ${sum.updated}　累计 ${sum.total_rows} 行`,
    `- 校验码：\`${shaLine[0]}\`（${Number(shaLine[1]).toLocaleString("zh-CN")} 字节）`,
    `- 深度指标：${sum.deep_matched}/${sum.count} 条${
      sum.no_deep
        ? `（${[
            sum.no_deep_fresh ? `${sum.no_deep_fresh} 条当天刚发，次日补` : "",
            sum.no_deep_image ? `${sum.no_deep_image} 条图文作品，接口不收录` : "",
          ]
            .filter(Boolean)
            .join("；")}）`
        : ""
    }`,
    `- 当日总播放：${sum.total_view.toLocaleString("zh-CN")}`,
    `- 当日新作品：${sum.new_works.length ? sum.new_works.map((t) => `「${t}」`).join("、") : "无"}`,
    `- 播放 Top3：${sum.top5
      .slice(0, 3)
      .map((t) => `${t.view.toLocaleString("zh-CN")}${t.c5 ? `（5s完播 ${t.c5}%）` : ""}`)
      .join(" ｜ ")}`,
    sum.anomalies.length ? `- ⚠️ 指标异常：${sum.anomalies.join("；")}` : null,
    `- 来源：${asJson ? "Agent 自动抓取" : "Claude Code 自动抓取"}`,
    "",
  ]
    .filter((x) => x !== null)
    .join(NL);

  const HEADER = `# 抓取状态日志${NL}${NL}> 排障口径：数据不对先查这里。最新记录在最上面。${NL}${NL}`;

  // 把旧日志按 "## 日期" 切成块，丢掉今天已有的块（重抓不重复记）
  let blocks = [];
  if (fs.existsSync(LOG)) {
    let cur = null;
    for (const line of fs.readFileSync(LOG, "utf8").split(/\r?\n/)) {
      if (line.startsWith("## ")) {
        if (cur) blocks.push(cur);
        cur = [line];
      } else if (cur) {
        cur.push(line);
      }
    }
    if (cur) blocks.push(cur);
  }
  blocks = blocks.filter((b) => b[0].trim() !== `## ${date}`);

  const body = blocks.map((b) => b.join(NL).replace(/\s+$/, "")).join(NL + NL);
  fs.writeFileSync(LOG, HEADER + entry + (body ? NL + body + NL : ""), "utf8");

  console.log(`${NL}✅ 全部完成。日志已记入 抓取状态.md`);
  finish(0, { ok: true, stage: "done", fetch: f.result || null, merge: m.result || null });
}

main().catch((e) => {
  console.error("❌ " + e.message);
  finish(1, { message: e.message });
});
