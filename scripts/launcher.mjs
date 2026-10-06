#!/usr/bin/env node
/* launcher.mjs —— 双击 启动.bat / 启动.command 后看到的界面
 *
 * 为什么界面放在 Node 里、而不是写在 .bat 里：
 *   .bat 文件里的中文，cmd 会按系统代码页（简体中文 Windows 是 936/GBK）去读。
 *   文件存成 UTF-8 就会变乱码，存成 GBK 又跟 Node 的输出对不上。
 *   所以 .bat 里一个中文字都不写，只负责切到 UTF-8 代码页再把这里叫起来。
 *
 * 两条硬规则（都踩过坑）：
 *   1. 整个会话只用**一个** readline 接口。两个接口抢同一个 stdin，
 *      会出现「按了回车程序就退出」这种在管道测试里复现不了的问题。
 *   2. 子进程一律 stdin: "ignore"。不跟子进程共用控制台输入句柄。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  CODE_ROOT, DATA_DIR, CONFIG_FILE,
  dataDirSource, isOnSystemDrive, writeConfig,
} from "./paths.mjs";
import { browserReady, PORT, PROFILE_DIR } from "./browser.mjs";
import { listPages, evaluate } from "./cdp.mjs";

const NL = String.fromCharCode(10);
const LINE = "═".repeat(48);
const THIN = "─".repeat(48);
const out = (s = "") => process.stdout.write(s + NL);
const clear = () => process.stdout.write("\x1b[2J\x1b[H");

const BS = String.fromCharCode(92); // 反斜杠，免得跟转义打架

// 数据目录在会话里可能被改，用变量记着，改完界面立刻刷新
let currentDir = DATA_DIR;
let currentDirSource = dataDirSource();
const rawOf = (d) => path.join(d, "raw");

// ────────────────────────────────────────────── 环境自检（启动时自动跑）

async function probeEnv({ launch = false } = {}) {
  const issues = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 22) issues.push(`Node.js 版本太低（当前 v${process.versions.node}，需要 22 以上）`);

  let writable = true;
  try {
    fs.mkdirSync(rawOf(currentDir), { recursive: true });
    const probe = path.join(rawOf(currentDir), ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
  } catch (e) {
    writable = false;
    issues.push("数据目录写不进去：" + e.message);
  }

  let loggedIn = false;
  let account = null;
  let browserUp = false;
  let douyinPageOpen = false;   // 浏览器在跑、但没开抖音页面时，登录状态是「不知道」，不是「没登录」
  try {
    browserUp = !!(await browserReady());
    if (browserUp) {
      const pages = await listPages(PORT);
      const page = pages.find((p) => (p.url || "").includes("creator.douyin.com"));
      douyinPageOpen = !!page;
      if (page) {
        const r = await evaluate(
          PORT, page.id,
          `fetch("/web/api/media/user/info/",{credentials:"include"})
             .then(r=>r.json())
             .then(j=>JSON.stringify({code:j.status_code,name:(j.user&&j.user.nickname)||""}))
             .catch(()=>({code:-1,name:""}))`,
          { awaitPromise: true, timeoutMs: 8000 }
        );
        const j = JSON.parse(r);
        if (j.code === 0) { loggedIn = true; account = j.name; }
      }
    }
  } catch { /* 探不到就当没登录，抓取时再处理 */ }

  return { issues, writable, browserUp, loggedIn, account, douyinPageOpen };
}

function envLine(env) {
  if (env.issues.length) return "环境：❌ 有问题（按 2 看详情）";
  if (env.loggedIn) return `环境：✅ 就绪 · 已登录${env.account ? " " + env.account : ""}`;
  if (!env.browserUp) return "环境：✅ 就绪（浏览器没在跑，抓取时会自动开）";
  if (!env.douyinPageOpen) return "环境：✅ 就绪（登录状态待确认，抓取时见分晓）";
  return "环境：⚠️ 还没登录抖音，抓取时会弹窗让你扫码";
}

// ────────────────────────────────────────────── 界面

function drawMenu(env) {
  clear();
  out();
  out("  抖音数据抓取");
  out();
  out("  你抖音后台的作品数据，每天存一份，攒成一张能看趋势的表。");
  out("  只看你自己账号的数据，不发布、不改后台、不代替你登录。");
  out();
  out("  " + THIN);
  out();
  out("  " + envLine(env));
  out(`  数据放在：${currentDir}`);
  if (isOnSystemDrive(currentDir)) {
    out("            （在 C 盘。C 盘紧张的话，按 4 换个位置）");
  }
  out();
  out("  " + THIN);
  out();
  out("  1  抓取今天的数据   跑完会更新总览和日志");
  out("  2  检查环境         看看缺什么、该怎么补");
  out("  3  打开数据文件夹   看看抓到了什么");
  out("  4  改数据保存位置   想放 D 盘或别处就按这个");
  out();
  out("  0  退出");
  out();
  out("  " + LINE);
  out();
  process.stdout.write("  请输入数字，然后回车：");
}

function showIssues(env) {
  out();
  if (!env.issues.length) {
    out("  环境没问题。");
    if (!env.loggedIn) {
      out("  登录状态：还没确认。第一次抓取会弹出浏览器窗口让你扫码，扫一次以后免登。");
    }
    return;
  }
  out("  发现这些问题：");
  out();
  env.issues.forEach((x, i) => out(`    ${i + 1}. ${x}`));
  out();
  out("  按 2 可以跑一次详细检查，它会告诉你每一项怎么补。");
}

// ────────────────────────────────────────────── 动作

function runNode(script, args = []) {
  // stdin 给 /dev/null：不跟子进程共用控制台输入，避免「回车把程序弄退」
  const r = spawnSync(process.execPath, [path.join(CODE_ROOT, "scripts", script), ...args], {
    stdio: ["ignore", "inherit", "inherit"],
    cwd: CODE_ROOT,
  });
  return r.status ?? 1;
}

function openFolder() {
  const target = fs.existsSync(currentDir) ? currentDir : CODE_ROOT;
  if (process.platform === "win32") spawnSync("explorer.exe", [target], { stdio: "ignore" });
  else if (process.platform === "darwin") spawnSync("open", [target], { stdio: "ignore" });
  else spawnSync("xdg-open", [target], { stdio: "ignore" });
  out();
  out("  已打开：" + target);
  out();
  out("  想看数据就看这两个：");
  out("    抖音数据总览.md   日常看这个（账号近 7 天 + 最近 15 条作品）");
  out("    抖音作品数据.csv  完整历史，双击用 Excel/WPS 打开");
  out("  ");
  out("  要发给别人或者存档，用「导出」文件夹里那份带日期的副本。");
}

async function changeDataDir(ask) {
  out();
  out("  现在数据放在：");
  out("    " + currentDir + "（" + currentDirSource + "）");
  out();
  out("  输入一个新文件夹的完整路径，数据以后就放那儿。");
  out("  比如 D:" + BS + "抖音数据 或者 E:" + BS + "我的资料" + BS + "抖音");
  out();
  out("  直接回车 = 不改，回到菜单。");
  out();

  let p = (await ask("  新路径：")).trim().replace(/^"|"$/g, "");
  if (!p) { out(); out("  没改。"); return; }

  // 盘符后面漏反斜杠是很常见的输入错误（写成 D:抖音数据）。
  // 不补的话 path.resolve 会把它当成「D 盘当前目录下的 抖音数据」，跑到别处去。
  if (/^[a-zA-Z]:[^\\/]/.test(p)) {
    const fixed = p.slice(0, 2) + BS + p.slice(2);
    out();
    out("  你写的是 " + p + "，盘符后面少了分隔符。");
    out("  按 " + fixed + " 处理。");
    p = fixed;
  }

  if (!path.isAbsolute(p)) {
    out();
    out("  ❌ 要写完整路径，从盘符开始。");
    out("     比如 D:" + BS + "抖音数据");
    out("     你写的 " + p + " 会跟着程序的当前位置跑，不是你想要的地方。");
    return;
  }

  const abs = path.resolve(p);
  try {
    fs.mkdirSync(rawOf(abs), { recursive: true });
    const probe = path.join(rawOf(abs), ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
  } catch (e) {
    out();
    out("  ❌ 这个位置写不进去：" + e.message);
    out("  换个位置再试，比如 D:" + BS + "抖音数据");
    return;
  }

  // 原来的位置里有数据就提一句，不自动搬（搬文件这种事得用户自己确认）
  const oldCsv = path.join(currentDir, "抖音作品数据.csv");
  if (fs.existsSync(oldCsv) && abs !== currentDir) {
    out();
    out("  注意：原来那个目录里已经有数据了：");
    out("    " + oldCsv);
    out("  换位置后，程序只看新位置，旧数据不会自动搬过去。");
    out("  想接着用旧数据，把 " + currentDir + " 里的文件复制到新位置就行。");
  }

  writeConfig({ dataDir: abs });
  currentDir = abs;                    // 界面立刻刷新，不用重启
  currentDirSource = "你自己设定的";
  out();
  out("  ✅ 已记住，界面里的位置也换过来了。数据以后放在：");
  out("    " + abs);
  out();
  out("  （想改回默认，把配置文件删掉即可：" + CONFIG_FILE + "）");
}

// ────────────────────────────────────────────── 主循环

async function main() {
  out();
  process.stdout.write("  正在检查环境…");

  // 自检要一两秒。readline 必须等它跑完再建 ——
  // 否则这段时间到达的输入会被 readline 收走，而此时没有 question 在等，行就被丢掉了。
  let env = await probeEnv();
  process.stdout.write("\r\x1b[K");

  // 只建一个 readline，全程用它
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));
  let exiting = false;

  // stdin 断了（窗口被关、或输入被重定向耗尽）不要闷声退出
  rl.on("close", () => {
    if (!exiting) {
      out();
      out("  输入被关掉了，程序退出。");
      out();
    }
  });

  for (;;) {
    drawMenu(env);
    const ans = (await ask("")).trim();

    if (ans === "0" || ans.toLowerCase() === "q") {
      exiting = true;
      out();
      out("  再见。");
      out();
      rl.close();
      return;
    }

    if (ans === "1") {
      clear();
      out();
      out("  开始抓取。第一次跑会弹出一个浏览器窗口让你扫码，那一步只能你本人做。");
      out();
      runNode("daily.mjs");
      await ask(NL + "  按回车回到菜单…");
      env = await probeEnv();
      continue;
    }

    if (ans === "2") {
      clear();
      out();
      out("  正在检查…");
      out();
      runNode("check.mjs", ["--launch"]);
      env = await probeEnv();
      showIssues(env);
      await ask(NL + "  按回车回到菜单…");
      continue;
    }

    if (ans === "3") {
      clear();
      openFolder();
      await ask(NL + "  按回车回到菜单…");
      continue;
    }

    if (ans === "4") {
      clear();
      await changeDataDir(ask);
      await ask(NL + "  按回车回到菜单…");
      continue;
    }

    if (ans === "") continue;   // 空回车就重画菜单，不算输错

    clear();
    out();
    out("  没看懂这个输入：" + JSON.stringify(ans));
    out("  请输入 1、2、3、4 或者 0。");
    await ask(NL + "  按回车回到菜单…");
  }
}

main().catch((e) => {
  out();
  out("  启动器出错了：" + e.message);
  out();
  process.exitCode = 1;
});
