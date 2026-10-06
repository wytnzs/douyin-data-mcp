#!/usr/bin/env node
/* mcp-config.mjs —— 生成「把这套能力接给 Agent」需要的配置
 *
 * 用法：
 *   node scripts/mcp-config.mjs              打印各客户端的配置（复制粘贴用）
 *   node scripts/mcp-config.mjs --install    直接注册到本机 Claude Code
 *
 * 为什么要有这个脚本：MCP 配置里必须写 mcp.mjs 的**绝对路径**，
 * 而这份东西放在哪台机器、哪个目录都不一样。让脚本自己算，用户不用手写路径。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CODE_ROOT } from "./paths.mjs";

const ROOT = CODE_ROOT;
const SERVER = path.join(ROOT, "scripts", "mcp.mjs");
const NODE = process.execPath;

const wantInstall = process.argv.includes("--install");

if (!fs.existsSync(SERVER)) {
  console.error("找不到 " + SERVER);
  process.exit(1);
}

// 不要手工转义反斜杠 —— JSON.stringify 会处理。手工转一遍会变成四层。
const CONFIG_JSON = {
  mcpServers: {
    douyin: { command: NODE, args: [SERVER] },
  },
};

const line = "─".repeat(66);

console.log("");
console.log("抖音数据抓取 · 接入 Agent");
console.log(line);
console.log("");
console.log("服务器脚本：" + SERVER);
console.log("Node 解释器：" + NODE);
console.log("");
console.log("注册之后，Agent 会多出 6 个工具：");
console.log("  douyin_status   看状态（浏览器/登录/今天抓没抓/累计多少行）");
console.log("  douyin_check    环境自检（缺什么说什么）");
console.log("  douyin_fetch    抓取 + 校验（不并表）");
console.log("  douyin_merge    并表 + 出总览");
console.log("  douyin_daily    一条命令全做完  ← 日常用这个");
console.log("  douyin_data     读总表数据做复盘分析");
console.log("");

// ---------------------------------------------------------------- 自动安装
if (wantInstall) {
  console.log(line);
  console.log("正在注册到本机 Claude Code…");
  const r = spawnSync("claude", ["mcp", "add", "douyin", "-s", "user", "--", NODE, SERVER], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status === 0) {
    console.log("");
    console.log("✅ 已注册。重启 Claude Code 后，直接说「抓一下抖音数据」即可。");
    console.log("   卸载：claude mcp remove douyin -s user");
  } else {
    console.log("");
    console.log("⚠️  自动注册没成功（可能没装 claude 命令）。用下面的配置手工加也一样。");
  }
  console.log("");
}

// ---------------------------------------------------------------- 各处配置
console.log(line);
console.log("【Claude Code】在终端里跑这一行：");
console.log("");
console.log(`  claude mcp add douyin -s user -- "${NODE}" "${SERVER}"`);
console.log("");
console.log("（把 -s user 换成 -s local 就只对当前项目生效）");
console.log("");

console.log(line);
console.log("【通用 MCP 配置】下面这段 JSON 适用于大多数支持 MCP 的客户端");
console.log("（Claude Desktop / Cursor / Cline / Codex / WorkBuddy 等，");
console.log("  具体填在哪个文件或哪个设置项，看各客户端自己的说明）：");
console.log("");
console.log(JSON.stringify(CONFIG_JSON, null, 2));
console.log("");

console.log(line);
console.log("【图形界面里手工填】如果客户端是「命令 + 参数」两个输入框：");
console.log("");
console.log("  命令：" + NODE);
console.log("  参数：" + SERVER);
console.log("  名称：douyin");
console.log("");

console.log(line);
console.log("【WorkBuddy】插件面板 → MCP → 添加，把上面那段 JSON 贴进去");
console.log("（或按「命令 + 参数」两个框分别填）。加完在对话里说「抓一下抖音数据」。");
console.log("");

console.log(line);
console.log("注意：");
console.log("  1. 路径必须写绝对路径，脚本已经替你算好了");
console.log("  2. 改了工具目录位置，上面的配置要重新生成一次");
console.log("  3. Agent 第一次跑会弹出专用浏览器窗口，需要你扫码登录一次抖音");
console.log("");
