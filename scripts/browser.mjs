/* browser.mjs —— 找到 / 启动一个带调试端口的浏览器
 *
 * 为什么要单独一个 profile：
 *   Chrome 136 起，对「默认用户目录」禁用 --remote-debugging-port。
 *   所以这里永远用一个专用目录（默认 ~/.douyin-data/browser-profile）。
 *   好处是跟你日常用的浏览器互不干扰，坏处是第一次要在那个窗口里单独登一次抖音——
 *   登一次就记住了，以后都免登。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { probe } from "./cdp.mjs";
import { readConfig } from "./paths.mjs";

export const PORT = Number(process.env.DOUYIN_CDP_PORT || 9333);
// 登录态所在的浏览器目录。可以用环境变量或配置文件改，默认在用户主目录下。
// 这里只有登录态（几百 MB），不是你的数据。
export const PROFILE_DIR =
  process.env.DOUYIN_PROFILE_DIR ||
  readConfig().browserDir ||
  path.join(os.homedir(), ".douyin-data", "browser-profile");

const CANDIDATES = {
  win32: [
    ["Chrome", path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Google/Chrome/Application/chrome.exe")],
    ["Chrome", path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe")],
    ["Chrome", path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")],
    ["Edge", path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft/Edge/Application/msedge.exe")],
    ["Edge", path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Microsoft/Edge/Application/msedge.exe")],
  ],
  darwin: [
    ["Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    ["Chrome", path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")],
    ["Edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    ["Chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
  ],
  linux: [
    ["Chrome", "/usr/bin/google-chrome"],
    ["Chrome", "/usr/bin/google-chrome-stable"],
    ["Chromium", "/usr/bin/chromium"],
    ["Chromium", "/usr/bin/chromium-browser"],
    ["Chromium", "/snap/bin/chromium"],
    ["Edge", "/usr/bin/microsoft-edge"],
  ],
};

/** 找到本机可用的 Chromium 系浏览器，返回 {name, exe} 或 null */
export function findBrowser() {
  for (const [name, exe] of CANDIDATES[process.platform] || []) {
    try {
      if (exe && fs.existsSync(exe)) return { name, exe };
    } catch {}
  }
  return null;
}

/** 确认调试端口上是我们能用的浏览器，返回版本信息或 null */
export async function browserReady() {
  return probe(PORT);
}

/**
 * 确保有一个带调试端口的浏览器在跑。
 * 返回 { ok, version, started, browser } —— 失败时 ok=false 并带 reason。
 */
export async function ensureBrowser({ launch = true, url = "about:blank" } = {}) {
  const existing = await browserReady();
  if (existing) return { ok: true, started: false, version: existing };

  const browser = findBrowser();
  if (!browser) {
    return {
      ok: false,
      reason: "没找到 Chrome / Edge / Chromium。请先装一个 Chromium 系浏览器再跑。",
    };
  }
  if (!launch) {
    return { ok: false, reason: "浏览器没在调试模式下运行，且当前不允许自动启动。", browser };
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const child = spawn(
    browser.exe,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      url,
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();

  // 等端口起来，最多 30 秒
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const v = await browserReady();
    if (v) return { ok: true, started: true, version: v, browser };
  }
  return { ok: false, reason: "浏览器启动了但调试端口一直没通，可能被杀软或策略拦了。", browser };
}
