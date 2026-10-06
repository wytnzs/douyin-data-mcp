/* paths.mjs —— 代码目录 / 数据目录的唯一来源
 *
 * 为什么要把这两件事拆开：
 *   用 npx 装的时候，代码在 ~/.npm/_npx/<hash>/ 里，随时可能被清掉。
 *   数据（总表、快照、日志）绝不能写在那儿，否则用户根本找不到自己的数据。
 *
 * 数据目录按这个顺序决定：
 *   1. DOUYIN_DATA_DIR 环境变量   （临时覆盖，最高优先）
 *   2. 配置文件里的 dataDir       （用户在菜单里选过，记在这里）
 *   3. 代码所在目录               （下载解压 / git clone 的默认，数据就在手边）
 *   4. ~/.douyin-data/data        （npx 用；bin/ 的入口会把环境变量指到这里）
 *
 * 配置文件故意放在固定的一个小地方（~/.douyin-data/config.json），
 * 它只有几十字节。真正占地方的数据由用户自己指定放哪。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 代码在哪（固定的，跟着工具包走） */
export const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 小配置和浏览器登录态放这儿（固定位置，方便找也方便删） */
export const HOME_DIR = path.join(os.homedir(), ".douyin-data");
export const CONFIG_FILE = path.join(HOME_DIR, "config.json");

/** npx 用法的默认数据目录 */
export const HOME_DATA_DIR = path.join(HOME_DIR, "data");

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) || {};
  } catch {
    return {};
  }
}

export function writeConfig(patch) {
  const next = Object.assign(readConfig(), patch);
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

const CONFIG = readConfig();

/** 数据放哪 */
export const DATA_DIR = process.env.DOUYIN_DATA_DIR
  ? path.resolve(process.env.DOUYIN_DATA_DIR)
  : CONFIG.dataDir
    ? path.resolve(CONFIG.dataDir)
    : CODE_ROOT;

/** 数据目录是怎么定下来的（给界面显示用） */
export function dataDirSource() {
  if (process.env.DOUYIN_DATA_DIR) return "环境变量指定";
  if (CONFIG.dataDir) return "你自己设定的";
  return "跟工具放一起（默认）";
}

/** 数据目录是不是「跟着代码放」的 */
export const DATA_IN_CODE_DIR = path.resolve(DATA_DIR) === path.resolve(CODE_ROOT);

export const RAW = path.join(DATA_DIR, "raw");
export const CSV = path.join(DATA_DIR, "抖音作品数据.csv");
export const OVERVIEW = path.join(DATA_DIR, "抖音数据总览.md");
export const LOG = path.join(DATA_DIR, "抓取状态.md");

/** 带日期的导出副本放这儿（主表名字不变，这是给人交付/存档用的那份） */
export const EXPORT_DIR = path.join(DATA_DIR, "导出");

export const COLLECT_JS = path.join(CODE_ROOT, "collect.js");
export const SCRIPTS_DIR = path.join(CODE_ROOT, "scripts");

/** 数据目录必须存在才能往里写 */
export function ensureDataDir() {
  fs.mkdirSync(RAW, { recursive: true });
  return DATA_DIR;
}

/** 给报错信息用的一句话，说明数据到底在哪儿 */
export function whereIsData() {
  return `数据目录：${DATA_DIR}（${dataDirSource()}）`;
}

/** 路径在不在 C 盘（Windows 上 C 盘通常紧张，值得提醒一句） */
export function isOnSystemDrive(p = DATA_DIR) {
  if (process.platform !== "win32") return false;
  return path.resolve(p).toLowerCase().startsWith("c:");
}
