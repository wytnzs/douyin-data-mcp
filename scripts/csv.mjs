/* csv.mjs —— CSV 读写，全库唯一一份
 *
 * 为什么要抽出来：merge / report / mcp 原先各自有一份解析器，改一处漏两处。
 * 2026-10-06 加 BOM 时就漏了 report.mjs，总览直接变成「0 条作品」。
 *
 * 关于 BOM：
 *   写出去的 CSV 开头必须带 UTF-8 BOM。中文 Windows 上 Excel/WPS 双击打开 .csv
 *   默认按 GBK 解，不带 BOM 的话中文全成乱码 —— 而用户就是拿 Excel 看这张表的。
 *   读回来时必须把 BOM 剥掉，否则第一列名会变成 "﻿capture_date"，主键就取不到了。
 *   这两件事都收在这里，外面不用管。
 */

export const BOM = "﻿";

/** 解析 CSV 文本 → { header: string[], rows: string[][] }，已剥 BOM */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }

  const kept = rows.filter((r) => r.length > 1 || (r[0] || "").trim() !== "");
  if (!kept.length) return { header: [], rows: [] };

  const header = kept[0].map((h, i) => (i === 0 ? h.replace(/^﻿/, "") : h));
  return { header, rows: kept.slice(1) };
}

/** 把 [{列名: 值}] 拼成 CSV 文本，开头带 BOM（给 Excel 认编码） */
export function stringifyCsv(header, objects) {
  const esc = (v) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [header.map(esc).join(",")];
  for (const o of objects) lines.push(header.map((h) => esc(o[h])).join(","));
  return BOM + lines.join("\n") + "\n";
}

/** 位置数组 → 对象数组（按 header 对齐） */
export function toObjects(header, rows) {
  return rows.map((r) => {
    const o = {};
    header.forEach((h, i) => (o[h] = r[i] ?? ""));
    return o;
  });
}
