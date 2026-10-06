#!/usr/bin/env node
/* launcher.mjs —— 双击 启动.bat / 启动.command 后看到的菜单
 *
 * 为什么菜单放在 Node 里、而不是写在 .bat 里：
 *   .bat 文件里的中文，cmd 会按系统代码页（简体中文 Windows 是 936/GBK）去读。
 *   文件存成 UTF-8 就会变乱码，存成 GBK 又跟 Node 的输出对不上。
 *   所以 .bat 里一个中文字都不写，只负责切到 UTF-8 代码页再把这里叫起来。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { CODE_ROOT, DATA_DIR, CSV, OVERVIEW, whereIsData } from "./paths.mjs";

const NL = String.fromCharCode(10);
const LINE = "═".repeat(46);
const THIN = "─".repeat(46);

const line = (s = "") => process.stdout.write(s + NL);
const clear = () => process.stdout.write("\x1b[2J\x1b[H");

function runNode(script, args = []) {
  // 环境变量透传，DOUYIN_DATA_DIR 之类的设置不会丢
  const r = spawnSync(process.execPath, [path.join(CODE_ROOT, "scripts", script), ...args], {
    stdio: "inherit",
    cwd: CODE_ROOT,
  });
  return r.status ?? 1;
}

function menu() {
  clear();
  line();
  line("  抖音数据抓取");
  line();
  line("  你抖音后台的作品数据，每天存一份，攒成一张能看趋势的表。");
  line("  只看你自己账号的数据，不发布、不改后台、不代替你登录。");
  line();
  line(LINE);
  line();
  line("  1  检查环境         第一次用先跑这个");
  line("  2  抓取今天的数据   跑完会更新总览和日志");
  line("  3  打开数据文件夹   看看抓到了什么");
  line();
  line("  0  退出");
  line();
  line(LINE);
  line();
  line("  " + whereIsData());
  line();
  process.stdout.write("  请输入数字，然后回车：");
}

function firstRunHint() {
  const hasData = fs.existsSync(CSV);
  if (hasData) return;
  line();
  line("  提示：你还没抓过数据。第一次跑会弹出一个浏览器窗口，");
  line("  让你用抖音 App 扫码登录。那一步只能你本人做，扫一次以后就不用扫了。");
  line();
}

function pause() {
  return new Promise((resolve) => {
    process.stdout.write(NL + "  按回车回到菜单…");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.once("line", () => { rl.close(); resolve(); });
  });
}

function openFolder() {
  const target = fs.existsSync(DATA_DIR) ? DATA_DIR : CODE_ROOT;
  if (process.platform === "win32") spawnSync("explorer.exe", [target]);
  else if (process.platform === "darwin") spawnSync("open", [target]);
  else spawnSync("xdg-open", [target]);
  line();
  line("  已打开：" + target);
  line();
  line("  想看数据就看这两个文件：");
  line("    抖音数据总览.md   日常看这个（账号近 7 天 + 最近 15 条作品）");
  line("    抖音作品数据.csv  完整历史，可以用 Excel 打开");
  line();
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));

  for (;;) {
    menu();
    const ans = (await ask("")).trim();

    if (ans === "0" || ans.toLowerCase() === "q") {
      line();
      line("  再见。");
      line();
      rl.close();
      return;
    }

    if (ans === "1") {
      clear();
      runNode("check.mjs", ["--launch"]);
      await pause();
      continue;
    }

    if (ans === "2") {
      clear();
      firstRunHint();
      runNode("daily.mjs");
      await pause();
      continue;
    }

    if (ans === "3") {
      clear();
      openFolder();
      await pause();
      continue;
    }

    // 输入了别的东西
    clear();
    line();
    line("  没看懂这个输入：" + JSON.stringify(ans));
    line("  请输入 1、2、3 或者 0。");
    await pause();
  }
}

main().catch((e) => {
  line();
  line("  启动器出错了：" + e.message);
  line();
  process.exitCode = 1;
});
