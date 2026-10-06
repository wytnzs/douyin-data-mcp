#!/usr/bin/env node
/* merge.mjs —— 把某天的快照并进总表
 *
 * 用法：node scripts/merge.mjs [raw/YYYY-MM-DD.json]
 * 不带参数时自动取 raw/ 下最新的一份。
 *
 * 并表规则（与手工流程一致）：
 *   - 主键 = 抓取日期 + 作品ID
 *   - 同键重复 → 覆盖旧行（重抓同一天不会翻倍）
 *   - 其它日期的行一条不动
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, RAW, CSV } from "./paths.mjs";
import { KEYS, toKey, toLabel } from "./columns.mjs";
import { parseCsv, stringifyCsv, toObjects } from "./csv.mjs";

// ---- CSV 读写：内部用英文 key，只在读写文件这一道边界上换中文表头 --------
function readTable() {
  if (!fs.existsSync(CSV)) return { header: KEYS.slice(), rows: [] };
  const parsed = parseCsv(fs.readFileSync(CSV, "utf8"));
  if (!parsed.header.length) return { header: KEYS.slice(), rows: [] };
  // 表头可能是中文（新文件）也可能是英文（老文件），统一认成内部 key，
  // 老文件下一次写出时就自动升级成中文表头了，不用手工改。
  const header = parsed.header.map(toKey);
  for (const c of KEYS) if (!header.includes(c)) header.push(c);   // 新增列只加在最后
  return { header, rows: toObjects(header, parsed.rows) };
}

function writeTable(header, rows) {
  const labels = header.map(toLabel);
  const out = rows.map((o) => {
    const n = {};
    header.forEach((k) => { n[toLabel(k)] = o[k]; });
    return n;
  });
  fs.writeFileSync(CSV, stringifyCsv(labels, out), "utf8");
}


// ---- 主流程 -------------------------------------------------------------
function pickSnapshot(arg) {
  if (arg) {
    const p = path.isAbsolute(arg) ? arg : path.join(DATA_DIR, arg);
    if (!fs.existsSync(p)) throw new Error("找不到文件：" + p);
    return p;
  }
  const files = fs.readdirSync(RAW).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error("raw/ 下还没有任何快照，先跑 node scripts/fetch.mjs");
  return path.join(RAW, files[files.length - 1]);
}

// 只把非 --flag 的参数当路径，否则 `merge.mjs --json` 会把 --json 当成文件名
const snapArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const snapPath = pickSnapshot(snapArg);
const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
const incoming = snap.records;
const captureDate = snap._meta.capture_date;

const { header, rows } = readTable();
const before = rows.length;

const index = new Map();
rows.forEach((r, i) => index.set(r.capture_date + "|" + r.aweme_id, i));

let added = 0, updated = 0;
const anomalies = [];

for (const rec of incoming) {
  const key = rec.capture_date + "|" + rec.aweme_id;
  const at = index.get(key);
  if (at === undefined) {
    rows.push(rec);
    index.set(key, rows.length - 1);
    added++;
  } else {
    // 深度指标末点缺失保护：老作品突然变成 0.00% 时标出来，不当作真实数据
    for (const col of ["completion_rate_5s_pct", "bounce_rate_2s_pct"]) {
      const oldV = parseFloat(rows[at][col]);
      const newV = parseFloat(rec[col]);
      if (oldV > 0 && newV === 0) anomalies.push(`${rec.aweme_id} 的 ${col} 由 ${oldV}% 变为 0.00%`);
    }
    rows[at] = Object.assign({}, rows[at], rec);
    updated++;
  }
}

rows.sort((a, b) =>
  a.capture_date === b.capture_date
    ? String(b.view).padStart(12, "0").localeCompare(String(a.view).padStart(12, "0"))
    : a.capture_date.localeCompare(b.capture_date)
);

writeTable(header, rows);

// ---- 报告 ---------------------------------------------------------------
const todayRows = incoming.slice().sort((a, b) => Number(b.view) - Number(a.view));
const totalView = todayRows.reduce((s, r) => s + (Number(r.view) || 0), 0);
const noDeep = incoming.filter((r) => !r.metrics_asof).length;

console.log(`快照文件   ${path.relative(DATA_DIR, snapPath)}`);
console.log(`抓取日期   ${captureDate}`);
console.log(`本次条数   ${incoming.length}`);
console.log(`新增       ${added}`);
console.log(`更新       ${updated}`);
console.log(`累计行数   ${rows.length}  （原 ${before}）`);
console.log(`当日总播放 ${totalView.toLocaleString()}`);
console.log("");
console.log("当日播放量 Top5：");
todayRows.slice(0, 5).forEach((r, i) => {
  const cr = r.completion_rate_5s_pct ? `5s完播 ${r.completion_rate_5s_pct}%` : "无深度指标";
  console.log(`  ${i + 1}. ${Number(r.view).toLocaleString().padStart(7)}  ${cr.padEnd(16)}  ${r.title.slice(0, 34)}`);
});
console.log("");
if (noDeep) {
  const img = incoming.filter((r) => !r.metrics_asof && r.media_type === "图文").length;
  const fresh = noDeep - img;
  const why = [fresh ? `${fresh} 条当天刚发（后台次日才算）` : "", img ? `${img} 条图文作品（接口不收录）` : ""]
    .filter(Boolean).join("，");
  console.log(`提示：${noDeep} 条暂无完播率等深度指标 —— ${why}。`);
}
if (anomalies.length) {
  console.log("");
  console.log("⚠️  指标异常（后台序列末点缺失，复盘时当空值处理，别写结论）：");
  anomalies.forEach((a) => console.log("   - " + a));
}
// 供 daily.mjs / MCP 读取的机器可读摘要
const SUMMARY = {
  capture_date: captureDate,
  count: incoming.length,
  added, updated,
  total_rows: rows.length,
  total_view: totalView,
  no_deep: noDeep,
  no_deep_image: incoming.filter((r) => !r.metrics_asof && r.media_type === "图文").length,
  no_deep_fresh: incoming.filter((r) => !r.metrics_asof && r.media_type !== "图文" && r.publish_date === captureDate).length,
  deep_matched: incoming.length - noDeep,
  top5: todayRows.slice(0, 5).map((r) => ({
    aweme_id: r.aweme_id, view: Number(r.view) || 0,
    c5: r.completion_rate_5s_pct || "", title: r.title.slice(0, 40),
  })),
  anomalies,
  new_works: incoming.filter((r) => r.publish_date === captureDate).map((r) => r.title.slice(0, 40)),
};
fs.writeFileSync(path.join(RAW, `${captureDate}.merge.json`), JSON.stringify(SUMMARY, null, 2), "utf8");

console.log(`总表：${path.relative(DATA_DIR, CSV)}`);
if (process.argv.includes("--json")) {
  console.log("@@RESULT@@" + JSON.stringify(Object.assign({ ok: true, code: 0 }, SUMMARY)));
}
