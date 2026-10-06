/* paths.mjs —— 代码目录 / 数据目录的唯一来源
 *
 * 为什么要把这两件事拆开：
 *   用 npx 装的时候，代码在 ~/.npm/_npx/<hash>/ 里，随时可能被清掉。
 *   数据（总表、快照、日志）绝不能写在那儿，否则用户根本找不到自己的数据。
 *
 * 规则：
 *   代码目录 = 这份脚本所在位置（固定的）
 *   数据目录 = DOUYIN_DATA_DIR 环境变量 → 否则代码目录
 *
 *   本地克隆 / 直接下载解压的使用者：没设环境变量，数据就放在工具目录里，
 *   打开就能看见，符合直觉。
 *   npx 的使用者：bin/ 里的入口会自动把 DOUYIN_DATA_DIR 指到 ~/.douyin-data/data。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 代码在哪 */
export const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** npx 用法的默认数据目录 */
export const HOME_DATA_DIR = path.join(os.homedir(), ".douyin-data", "data");

/** 数据放哪 */
export const DATA_DIR = process.env.DOUYIN_DATA_DIR
  ? path.resolve(process.env.DOUYIN_DATA_DIR)
  : CODE_ROOT;

/** 数据目录是不是「跟着代码放」的（用来在出错信息里说清楚数据到底在哪） */
export const DATA_IN_CODE_DIR = path.resolve(DATA_DIR) === path.resolve(CODE_ROOT);

export const RAW = path.join(DATA_DIR, "raw");
export const CSV = path.join(DATA_DIR, "抖音作品数据.csv");
export const OVERVIEW = path.join(DATA_DIR, "抖音数据总览.md");
export const LOG = path.join(DATA_DIR, "抓取状态.md");

export const COLLECT_JS = path.join(CODE_ROOT, "collect.js");
export const SCRIPTS_DIR = path.join(CODE_ROOT, "scripts");

/** 数据目录必须存在才能往里写 */
export function ensureDataDir() {
  fs.mkdirSync(RAW, { recursive: true });
  return DATA_DIR;
}

/** 给报错信息用的一句话，说明数据到底在哪儿 */
export function whereIsData() {
  return DATA_IN_CODE_DIR
    ? `数据目录：${DATA_DIR}（跟工具放一起）`
    : `数据目录：${DATA_DIR}（由 DOUYIN_DATA_DIR 指定）`;
}
