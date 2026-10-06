#!/usr/bin/env node
/* export.mjs —— 生成带日期的导出副本
 *
 * 为什么要有这一步：
 *   主表《抖音作品数据.csv》是按天累积的，名字必须固定，不然累积就断了。
 *   但拿给人看、发给别人、存档的时候，一个不带日期的文件名说不清是哪天的数据。
 *   所以另出一份带日期的副本，放 导出/ 里。主表照旧累积，两边互不影响。
 *
 * 同一天重复跑，覆盖同一个文件，不会攒出一堆重复的。
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, CSV, OVERVIEW, EXPORT_DIR } from "./paths.mjs";
import { parseCsv } from "./csv.mjs";
import { toKey } from "./columns.mjs";

const asJson = process.argv.includes("--json");

function latestCaptureDate() {
  if (!fs.existsSync(CSV)) return null;
  const { header, rows } = parseCsv(fs.readFileSync(CSV, "utf8"));
  const i = header.map(toKey).indexOf("capture_date");
  if (i === -1) return null;
  const dates = rows.map((r) => (r[i] || "").trim()).filter(Boolean).sort();
  return dates[dates.length - 1] || null;
}

const date = latestCaptureDate();
if (!date) {
  console.error("❌ 总表还不存在或者没有数据，没法导出。先抓一次。");
  process.exit(1);
}

fs.mkdirSync(EXPORT_DIR, { recursive: true });

const made = [];
const jobs = [
  [CSV, `抖音作品数据_${date}.csv`],
  [OVERVIEW, `抖音数据总览_${date}.md`],
];
for (const [src, name] of jobs) {
  if (!fs.existsSync(src)) continue;
  const dst = path.join(EXPORT_DIR, name);
  fs.copyFileSync(src, dst);
  made.push(name);
}

console.log("");
console.log(`导出副本（日期 ${date}）：`);
made.forEach((n) => console.log("  " + path.join(path.relative(DATA_DIR, EXPORT_DIR), n)));
console.log(`  位置：${EXPORT_DIR}`);
console.log("");
console.log("  这份是给你交付、存档、发人用的。主表名字不变，继续按天累积。");

if (asJson) {
  console.log("@@RESULT@@" + JSON.stringify({ ok: true, code: 0, capture_date: date, files: made, dir: EXPORT_DIR }));
}
