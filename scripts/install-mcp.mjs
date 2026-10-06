#!/usr/bin/env node
/* install-mcp.mjs —— 把抖音数据抓取接给 Agent
 *
 * 为什么要有这个脚本：
 *   「接 MCP」这件事各家做法不一样，很多人卡在"往哪填这段 JSON"。
 *   Claude Code 有一句命令是因为它**自带命令行工具**；别的工具没有，
 *   只能自己在设置界面填、或者手改配置文件。协议是同一个，差别只在入口。
 *
 * ★ 关于联网（2026-10-06 实测后改的）：
 *   早先推荐 `npx -y github:wytnzs/douyin-data-mcp`，看着最省事，但**靠不住**：
 *   npx 对 github: 来源的包**每次都去 codeload.github.com 重新下载**，本地缓存不顶用。
 *   实测（npm 离线模式）：本地那份照样跑，npx github 那份直接报 ENOTCACHED。
 *   也就是说学员那边 GitHub 一断，MCP 就起不来。
 *   所以现在默认推荐**指向本地这份**——配置里写本机绝对路径，一个字都不联网。
 *
 * 用法：node scripts/install-mcp.mjs [--write]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CODE_ROOT } from "./paths.mjs";

const NAME = "douyin";
const NPX_PKG = "github:wytnzs/douyin-data-mcp";
const SERVER = path.join(CODE_ROOT, "scripts", "mcp.mjs");
const doWrite = process.argv.includes("--write");
const NL = String.fromCharCode(10);

const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const home = os.homedir();

const out = (s = "") => process.stdout.write(s + NL);
const has = (p) => { try { return fs.existsSync(p); } catch { return false; } };

// 只列「配置文件已经在」的客户端 —— 说明这个路径就是它认的。
// 文件不存在就不瞎猜，免得把人家的配置写坏。
const CLIENTS = [
  { id: "claude-code", label: "Claude Code", cfg: path.join(home, ".claude.json"), how: "cli" },
  { id: "claude-desktop", label: "Claude 桌面版", cfg: path.join(appData, "Claude", "claude_desktop_config.json") },
  { id: "cursor", label: "Cursor", cfg: path.join(home, ".cursor", "mcp.json") },
  { id: "cline", label: "Cline（VS Code 插件）", cfg: path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json") },
  { id: "windsurf", label: "Windsurf", cfg: path.join(home, ".codeium", "windsurf", "mcp_config.json") },
];

function workbuddyPresent() {
  return has(path.join(localAppData, "WorkBuddy")) || has(path.join(appData, "WorkBuddy"));
}

function haveClaudeCli() {
  return spawnSync("claude", ["--version"], { shell: process.platform === "win32", stdio: "ignore" }).status === 0;
}

/** 本机绝对路径版配置（不联网） */
function localConfig() {
  return { mcpServers: { [NAME]: { command: process.execPath, args: [SERVER] } } };
}

function writeInto(client) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(client.cfg, "utf8")) || {}; } catch { cfg = {}; }
  if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") cfg.mcpServers = {};
  cfg.mcpServers[NAME] = localConfig().mcpServers[NAME];

  const bak = client.cfg + ".bak";
  if (!has(bak)) fs.copyFileSync(client.cfg, bak);   // 只在第一次备份，不覆盖更早的
  fs.writeFileSync(client.cfg, JSON.stringify(cfg, null, 2), "utf8");
  return bak;
}

const AGENT_PROMPT = [
  `请帮我装一个 MCP server，名字叫 ${NAME}。`,
  ``,
  `它是本地 stdio 类型，启动方式是：`,
  `  命令：${process.execPath}`,
  `  参数：${SERVER}`,
  ``,
  `注意：命令和参数都照抄，一个字都不要改，也不要去下载任何东西 ——`,
  `这个 server 已经在我电脑上了。`,
  ``,
  `如果你能直接改自己的 MCP 配置，就自己改完，改完告诉我「配好了」并说明要不要重启你；`,
  `如果你改不了，就告诉我该在哪个界面的哪个输入框里填什么，一步一步说清楚。`,
];

function main() {
  const found = CLIENTS.map((c) => Object.assign({}, c, { present: has(c.cfg) }));
  const installed = found.filter((c) => c.present);

  out();
  out("═".repeat(60));
  out("  把抖音数据抓取接给你的 Agent");
  out("═".repeat(60));
  out();
  out("  接上之后，你只要说一句「抓一下我抖音的数据」，Agent 自己就跑完了。");
  out("  它是个标准 MCP server，所有支持 MCP 的 Agent 都能用。");
  out();

  out("─".repeat(60));
  out("  你机器上检测到：");
  out();
  installed.forEach((c) => out("    ✅ " + c.label));
  if (workbuddyPresent()) out("    ✅ WorkBuddy（它的 MCP 配置位置因版本而异，用方式一最稳）");
  if (!installed.length && !workbuddyPresent()) out("    （没检测到已知客户端，不影响下面的方法）");
  out();

  out("─".repeat(60));
  out("  方式一 · 让 Agent 自己装   ★ 最省事，推荐（不联网）");
  out();
  out("  你的 Agent 本来就会改配置。把下面这段整段复制，粘到它的对话框里发出去：");
  out();
  out("  ┌" + "─".repeat(56));
  AGENT_PROMPT.forEach((l) => out("  │ " + l));
  out("  └" + "─".repeat(56));
  out();

  out("─".repeat(60));
  out("  方式二 · 一行命令（Claude Code 这类带命令行工具的）");
  out();
  if (haveClaudeCli()) {
    out("  你这台机器有 claude 命令，直接跑这行：");
    out();
    out(`    claude mcp add ${NAME} -s user -- "${process.execPath}" "${SERVER}"`);
    out();
    out("  跑完重启 Claude Code，用 /mcp 能看到 douyin 连着。");
  } else {
    out("  没检测到 claude 命令，跳过。用方式一或方式三。");
  }
  out();

  out("─".repeat(60));
  out("  方式三 · 在设置界面里手工填（WorkBuddy、Cursor 等）");
  out();
  out("  打开设置，找到 MCP（有的叫「MCP 服务器」，有的在「插件」里），点「添加」。");
  out("  填这两个框，**照抄，一个字都别改**：");
  out();
  out("    名称：" + NAME);
  out("    命令：" + process.execPath);
  out("    参数：" + SERVER);
  out();
  out("  只给一个「粘贴 JSON」框的话，贴这段：");
  out();
  out("    " + JSON.stringify(localConfig()));
  out();

  out("─".repeat(60));
  out("  关于联网（重要）");
  out();
  out("  上面填的都是**本机路径**，所以：");
  out("    · 不用装任何东西，不用 npm install");
  out("    · 不用连 GitHub，断网也能跑");
  out("    · 以后这份工具挪了位置，配置要重新生成一次（再跑一遍本脚本）");
  out();
  out("  网上常见的那种 `npx -y github:xxx` 写法看着更短，但 npx 对一个");
  out("  github 来源的包**每次都去重新下载**，GitHub 一断就用不了。");
  out("  所以这里不推荐那种写法。");
  out();

  if (doWrite && installed.length) {
    out("─".repeat(60));
    out("  自动写入");
    out();
    for (const c of installed) {
      if (c.how === "cli") {
        const r = spawnSync("claude", ["mcp", "add", NAME, "-s", "user", "--", process.execPath, SERVER], {
          shell: process.platform === "win32", stdio: "ignore",
        });
        out(`    ${r.status === 0 ? "✅" : "⚠️ "} ${c.label}：命令行注册${r.status === 0 ? "成功" : "失败，改用方式一"}`);
      } else {
        try {
          const bak = writeInto(c);
          out(`    ✅ ${c.label}：已写入 ${path.basename(c.cfg)}（原文件备份为 ${path.basename(bak)}）`);
        } catch (e) {
          out(`    ⚠️  ${c.label}：写不进去（${e.message}），改用方式一`);
        }
      }
    }
    out();
    out("  改完重启对应的 Agent 才生效。");
    out();
  }

  out("═".repeat(60));
  out("  装完怎么验证：跟 Agent 说「看一下抖音数据抓取的状态」。");
  out("  它应该调用 douyin_status，并告诉你浏览器和登录状态。");
  out();
}

main();
