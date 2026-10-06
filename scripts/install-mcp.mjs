#!/usr/bin/env node
/* install-mcp.mjs —— 把抖音数据抓取接给 Agent
 *
 * 为什么要有这个脚本：
 *   「接 MCP」这件事各家的做法不一样，很多人卡在"往哪填这段 JSON"。
 *   Claude Code 有一句命令是因为它**自带命令行工具**；别的工具没有，
 *   只能自己在设置界面里填、或者手改配置文件。协议是同一个，差别只在
 *   人家有没有给你做个方便的入口。
 *
 *   所以这里给三条路，从最省事排到最兜底：
 *     方式一：让 Agent 自己装（最省事 —— 你的 Agent 本来就会改配置）
 *     方式二：命令行一句（Claude Code 这类有 CLI 的）
 *     方式三：图形界面手工填（命令 + 参数两个框）
 *
 * 用法：node scripts/install-mcp.mjs [--write]
 *   --write 时，对已检测到的客户端直接写配置（先备份原文件）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PKG = "github:wytnzs/douyin-data-mcp";
const NAME = "douyin";
const doWrite = process.argv.includes("--write");
const NL = String.fromCharCode(10);

const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const home = os.homedir();

// 只列「配置文件已经在」的客户端 —— 说明这个路径就是它认的。
// 文件不存在就不瞎猜，免得把人家的配置写坏。
const CLIENTS = [
  { id: "claude-code", label: "Claude Code", cfg: path.join(home, ".claude.json"), how: "cli" },
  { id: "claude-desktop", label: "Claude 桌面版", cfg: path.join(appData, "Claude", "claude_desktop_config.json") },
  { id: "cursor", label: "Cursor", cfg: path.join(home, ".cursor", "mcp.json") },
  { id: "cline", label: "Cline（VS Code 插件）", cfg: path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json") },
  { id: "windsurf", label: "Windsurf", cfg: path.join(home, ".codeium", "windsurf", "mcp_config.json") },
];

const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");

/** WorkBuddy 的 MCP 配置位置各家版本不一样，没法可靠地写。
 *  这里只判断装没装，具体怎么加走「方式一」让它自己配。 */
function workbuddyPresent() {
  return has(path.join(localAppData, "WorkBuddy")) || has(path.join(appData, "WorkBuddy"));
}

const out = (s = "") => process.stdout.write(s + NL);
const has = (p) => { try { return fs.existsSync(p); } catch { return false; } };

function detect() {
  return CLIENTS.map((c) => Object.assign({}, c, { present: has(c.cfg) }));
}

function haveClaudeCli() {
  const r = spawnSync("claude", ["--version"], { shell: process.platform === "win32", stdio: "ignore" });
  return r.status === 0;
}

/** 往配置文件里合并 douyin 这一项，先备份 */
function writeInto(client) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(client.cfg, "utf8")) || {}; } catch { cfg = {}; }
  if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") cfg.mcpServers = {};
  cfg.mcpServers[NAME] = { command: "npx", args: ["-y", PKG] };

  const bak = client.cfg + ".bak";
  if (!has(bak)) fs.copyFileSync(client.cfg, bak);   // 只在第一次备份，不覆盖更早的备份
  fs.writeFileSync(client.cfg, JSON.stringify(cfg, null, 2), "utf8");
  return bak;
}

function main() {
  const found = detect();
  const installed = found.filter((c) => c.present);

  out();
  out("═".repeat(58));
  out("  把抖音数据抓取接给你的 Agent");
  out("═".repeat(58));
  out();
  out("  接上之后，你只要说一句「抓一下我抖音的数据」，Agent 自己就跑完了。");
  out("  它本身是个标准 MCP server，所有支持 MCP 的 Agent 都能用。");
  out();

  // ---- 先说你机器上有什么 --------------------------------------------
  out("─".repeat(58));
  out("  你机器上检测到：");
  out();
  if (installed.length) {
    installed.forEach((c) => out("    ✅ " + c.label));
  }
  if (workbuddyPresent()) {
    out("    ✅ WorkBuddy（它的 MCP 配置位置因版本而异，用方式一让它自己配最稳）");
  } else if (installed.length) {
    out("    ✅ WorkBuddy —— 没检测到，装了的话用方式一");
  }
  if (!installed.length && !workbuddyPresent()) {
    out("    （没检测到已知客户端，不影响下面的方法 —— 下面的方法不依赖检测）");
  }
  out();

  // ---- 方式一：让 Agent 自己装 ----------------------------------------
  out("─".repeat(58));
  out("  方式一 · 让 Agent 自己装   ★ 最省事，推荐先试这个");
  out();
  out("  你的 Agent 本来就会改配置。把下面这段整段复制，粘到它的对话框里发出去：");
  out();
  out("  ┌" + "─".repeat(54));
  const prompt = [
    `请帮我装一个 MCP server，名字叫 ${NAME}。`,
    ``,
    `它是本地 stdio 类型，启动方式是：`,
    `  命令：npx`,
    `  参数：-y ${PKG}`,
    ``,
    `两个要求：`,
    `1. 装的时候不要改路径，就用上面这两个值。`,
    `2. 装完告诉我「配好了」，并说明我需不需要重启你。`,
    ``,
    `如果你能直接改自己的 MCP 配置，就自己改完；`,
    `如果你改不了，就告诉我该在哪个界面的哪个输入框里填什么，一步一步说清楚。`,
  ];
  prompt.forEach((l) => out("  │ " + l));
  out("  └" + "─".repeat(54));
  out();

  // ---- 方式二：命令行一句 ---------------------------------------------
  out("─".repeat(58));
  out("  方式二 · 一行命令（Claude Code 这类带命令行工具的）");
  out();
  if (haveClaudeCli()) {
    out("  你这台机器有 claude 命令，直接跑这行：");
    out();
    out(`    claude mcp add ${NAME} -s user -- npx -y ${PKG}`);
    out();
    out("  跑完重启 Claude Code，用 /mcp 能看到 douyin 连着。");
  } else {
    out("  没检测到 claude 命令，跳过。");
  }
  out();
  out("  为什么只有 Claude Code 能这么省事？因为它**自带了命令行工具**，");
  out("  这条命令其实就是帮你把配置写进文件，省得你自己找、自己填。");
  out("  别的工具只是没做这个入口，协议完全一样。");
  out();

  // ---- 方式三：图形界面手工填 -----------------------------------------
  out("─".repeat(58));
  out("  方式三 · 在设置界面里手工填（WorkBuddy、Cursor 等）");
  out();
  out("  打开 Agent 的设置，找到 MCP（有的叫「MCP 服务器」或「插件 → MCP」），");
  out("  点「添加」，会出现几个输入框。填这两项就行，一个字都别改：");
  out();
  out("    名称：" + NAME);
  out("    命令：npx");
  out("    参数：-y " + PKG);
  out();
  out("  如果它只给你一个「粘贴 JSON」的框，贴这段：");
  out();
  out("    " + JSON.stringify({ mcpServers: { [NAME]: { command: "npx", args: ["-y", PKG] } } }));
  out();
  out("  注意：这段里**没有任何路径**，所以照抄就行，不用改成你自己的。");
  out();

  // ---- 自动写（可选） --------------------------------------------------
  if (doWrite && installed.length) {
    out("─".repeat(58));
    out("  自动写入");
    out();
    for (const c of installed) {
      if (c.how === "cli") {
        const r = spawnSync("claude", ["mcp", "add", NAME, "-s", "user", "--", "npx", "-y", PKG], {
          shell: process.platform === "win32", stdio: "ignore",
        });
        out(`    ${r.status === 0 ? "✅" : "⚠️ "} ${c.label}：走命令行注册${r.status === 0 ? "成功" : "失败，改用方式一"}`);
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

  out("═".repeat(58));
  out("  装完怎么验证：跟 Agent 说「看一下抖音数据抓取的状态」。");
  out("  它应该调用 douyin_status 并告诉你浏览器和登录状态。");
  out();
}

main();
