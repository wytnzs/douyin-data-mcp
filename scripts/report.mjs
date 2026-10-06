#!/usr/bin/env node
/* report.mjs —— 由快照生成《抖音数据总览.md》
 * 用法：node scripts/report.mjs [raw/YYYY-MM-DD.json]
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, RAW, CSV, OVERVIEW as OUT } from "./paths.mjs";


function pick(arg) {
  if (arg) return path.isAbsolute(arg) ? arg : path.join(DATA_DIR, arg);
  const files = fs.readdirSync(RAW).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error("raw/ 下还没有快照");
  return path.join(RAW, files[files.length - 1]);
}

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return { header: [], rows: [] };
  const header = rows[0];
  return { header, rows: rows.slice(1).filter((r) => r.join("").trim()).map((r) => { const o = {}; header.forEach((h, i) => (o[h] = r[i] ?? "")); return o; }) };
}

const snapPath = pick(process.argv[2]);
const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
const meta = snap._meta;
const date = meta.capture_date;
const acct = (meta.account || {}).nickname || "（账号昵称未取到）";

const { rows } = parseCsv(fs.readFileSync(CSV, "utf8"));
const dates = [...new Set(rows.map((r) => r.capture_date))].sort();
const prevDate = dates.filter((d) => d < date).pop() || null;

const metric = (block, name) => {
  const m = (block?.metrics || []).find((x) => x.english_metric_name === name);
  return m ? m.metric_value : null;
};
const pct = (v) => (v === null || v === undefined ? "—" : (v * 100).toFixed(2) + "%");
const num = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("zh-CN"));
const sec = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1) + " 秒");
const delta = (cur, prev) => {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return "";
  const d = cur - prev;
  return d === 0 ? "" : d > 0 ? ` ↑${Number(d).toLocaleString("zh-CN")}` : ` ↓${Number(Math.abs(d)).toLocaleString("zh-CN")}`;
};

const dash = snap.dashboard, fans = snap.fans;
const byDate = (d) => rows.filter((r) => r.capture_date === d);
const today = byDate(date);
const yday = prevDate ? byDate(prevDate) : [];

// 每条的播放增量（播放量是累计值，增量 = 今天 − 上次同一条）
const prevView = new Map(yday.map((r) => [r.aweme_id, Number(r.view)]));
const sorted = today.slice().sort((a, b) => Number(b.view) - Number(a.view));

const L = [];
L.push("---");
L.push("title: 抖音数据总览");
L.push("type: dashboard");
L.push(`description: 抖音账号「${acct}」作品数据总览，抓取日 ${date}`);
L.push(`updated: ${date}`);
L.push("---");
L.push("");
L.push(`# 抖音数据总览`);
L.push("");
L.push(`> 账号「${acct}」· 抓取日 ${date} · 数据来源 creator.douyin.com 创作者后台 · 只读自己账号`);
L.push(`> 深度指标截至 ${meta.range ? today.find((r) => r.metrics_asof)?.metrics_asof || "—" : "—"}（后台规律：指标截至 = 抓取日 − 1）`);
L.push("");
L.push(`## 账号近 7 天`);
L.push("");
L.push("| 指标 | 值 | 说明 |");
L.push("|---|---|---|");
L.push(`| 播放量 | ${num(metric(dash, "play_cnt"))} | 近 7 天累计 |`);
L.push(`| 作品点赞 | ${num(metric(dash, "digg_cnt"))} | |`);
L.push(`| 作品评论 | ${num(metric(dash, "comment_cnt"))} | |`);
L.push(`| 作品分享 | ${num(metric(dash, "share_count"))} | |`);
L.push(`| 净增粉丝 | ${num(metric(dash, "net_fans_cnt"))} | |`);
L.push(`| 总粉丝量 | ${num(metric(dash, "total_fans_cnt"))} | |`);
L.push(`| 封面点击率 | ${pct(metric(dash, "cover_click_ratio"))} | 决定有没有人点进来 |`);
L.push(`| 5 秒完播率 | ${pct(metric(dash, "completion_rate_5s"))} | 决定能不能留住人 |`);
L.push(`| 2 秒跳出率 | ${pct(metric(dash, "bounce_rate_2s"))} | 越低越好 |`);
L.push(`| 平均播放时长 | ${sec(metric(dash, "avg_view_second"))} | |`);
L.push("");
L.push(`## 最近 15 条作品`);
L.push("");
L.push("| 发布日 | 类型 | 标题 | 播放 | 较上次 | 点赞 | 评论 | 分享 | 收藏 | 5秒完播% | 2秒跳出% | 均播秒 |");
L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of sorted.slice(0, 15)) {
  const pv = prevView.get(r.aweme_id);
  L.push(
    `| ${r.publish_date} | ${r.media_type || "视频"} | ${r.title.slice(0, 26).replace(/\|/g, "/")} | ${num(r.view)} |${delta(Number(r.view), pv) || " —"} | ${r.like} | ${r.comment} | ${r.share} | ${r.collect} | ${r.completion_rate_5s_pct || "—"} | ${r.bounce_rate_2s_pct || "—"} | ${r.avg_view_sec || "—"} |`
  );
}
L.push("");
const noDeep = today.filter((r) => !r.metrics_asof);
if (noDeep.length) {
  const img = noDeep.filter((r) => r.media_type === "图文");
  const fresh = noDeep.filter((r) => r.media_type !== "图文" && r.publish_date === date);
  const other = noDeep.filter((r) => r.media_type !== "图文" && r.publish_date !== date);
  const why = [];
  if (fresh.length) why.push(`${fresh.length} 条当天刚发，后台次日才算`);
  if (img.length) why.push(`${img.length} 条是图文作品，深度指标接口不收录（${img.map((r) => r.publish_date).join("、")}）`);
  if (other.length) why.push(`${other.length} 条原因待查（${other.map((r) => r.publish_date).join("、")}）`);
  L.push(`> ${noDeep.length} 条暂无深度指标：${why.join("；")}。`);
  L.push("");
}
L.push(`## 口径备忘`);
L.push("");
L.push("- **播放量是累计值，不是当日增量**。当日增量 = 今天这行 − 上一天同一条作品的播放。");
L.push("- **指标截至 = 抓取日 − 1**。几点抓都一样。");
L.push("- **总播放会被单条大爆款拉偏**。对比自己时看中位数、看「和上一条系列比」更准。");
L.push("- **老作品某项突然变 0.00%**：后台指标序列末点缺失，别当真实数据用，复盘时当空值处理。");
L.push("- 单条「整体完播率」「单条涨粉」后台未开放接口，本表留空。");
L.push("");
L.push(`---`);
L.push(`原始快照：\`raw/${date}.json\`　总表：\`抖音作品数据.csv\``);
L.push("");

fs.writeFileSync(OUT, L.join("\n"), "utf8");
console.log(`已生成 ${path.relative(DATA_DIR, OUT)}（${sorted.length} 条作品，${dates.length} 个抓取日）`);
