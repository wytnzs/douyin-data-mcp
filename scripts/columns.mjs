/* columns.mjs —— 表格列的唯一来源
 *
 * 为什么内部还用英文 key：
 *   合并的主键、总览的取数、MCP 返回的结构，全都按 key 走。key 一改，这几处
 *   得同时改，容易漏。所以就在 CSV 这一道边界上做中文转换：
 *
 *     写文件 → 用中文表头（用户拿 Excel 打开看得懂）
 *     读文件 → 认中文表头，也认老的英文表头（老文件能平滑升级，不用手改）
 *     程序内部 → 一律用英文 key
 *
 * 加列的时候：在 COLUMNS 末尾加一项。别插在中间，也别改已有项的 key
 * （key 是数据的主键依据，改了就对不上老数据了）。
 */

export const COLUMNS = [
  { key: "capture_date",           label: "抓取日期" },
  { key: "aweme_id",               label: "作品ID" },
  { key: "title",                  label: "标题" },
  { key: "publish_date",           label: "发布日期" },
  { key: "duration_sec",           label: "时长(秒)" },
  { key: "view",                   label: "播放量" },
  { key: "like",                   label: "点赞" },
  { key: "comment",                label: "评论" },
  { key: "share",                  label: "分享" },
  { key: "collect",                label: "收藏" },
  { key: "completion_rate_pct",    label: "完播率(%)" },
  { key: "completion_rate_5s_pct", label: "5秒完播率(%)" },
  { key: "bounce_rate_2s_pct",     label: "2秒跳出率(%)" },
  { key: "avg_view_sec",           label: "平均播放(秒)" },
  { key: "fan_gain",               label: "涨粉" },
  { key: "metrics_asof",           label: "指标截至" },
  { key: "media_type",             label: "类型" },
];

/** 内部用的列名（英文 key） */
export const KEYS = COLUMNS.map((c) => c.key);

/** 写 CSV 时用的表头（中文） */
export const LABELS = COLUMNS.map((c) => c.label);

const BY_KEY = new Map(COLUMNS.map((c) => [c.key, c.key]));
const BY_LABEL = new Map(COLUMNS.map((c) => [c.label, c.key]));

/** 把表头里的一格认成内部 key。
 *  认不出来就原样返回 —— 这样别人手工往表里加了列也不会被吃掉。 */
export function toKey(name) {
  const n = String(name || "").trim();
  if (BY_KEY.has(n)) return n;
  if (BY_LABEL.has(n)) return BY_LABEL.get(n);
  return n;
}

/** 把内部 key 换回中文表头，给写文件用 */
export function toLabel(key) {
  const hit = COLUMNS.find((c) => c.key === key);
  return hit ? hit.label : key;
}
