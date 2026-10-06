---
title: 抖音数据抓取 · 接入 Agent
type: guide
status: active
created: 2026-10-06
updated: 2026-10-06
---

# 接入 Agent

让 Agent（Claude Code / WorkBuddy / Codex / Cursor / 任何支持 MCP 的）**直接调用**抖音数据抓取，
你只需要说一句「抓一下我抖音的数据」，不用自己敲命令、不用记步骤。

**原理**：这套工具带一个 **MCP server**（`scripts/mcp.mjs`）。MCP 是 Agent 调用外部工具的标准协议，
接上之后，Agent 会多出 6 个工具，它自己决定什么时候调、怎么调。

---

## 〇、如果你是从别人那里拿到这个包的

三步，十分钟以内：

**1. 解压到任意位置**（路径别带特殊字符就行，中英文都可以）

**2. 先让人能跑起来** —— 照 `操作手册.md` 第二节：装 Node.js 22+ → 双击 `启动.bat`
（macOS 是 `启动.command`）→ 在弹出的浏览器窗口扫码登录一次抖音。

**3. 再让 Agent 能调它** —— 在解压出来的目录里跑：

```
node scripts/mcp-config.mjs
```

它会算出**你这台机器上的绝对路径**，打印出可以直接粘贴的配置。按下面的说明贴进你的 Agent。

> ⚠️ **不要找别人要他的配置文件**。MCP 配置里写的是绝对路径，指向的是他的电脑，
> 你填了必然连不上。必须自己在自己机器上跑一次 `mcp-config.mjs`。

接好之后，你只要跟 Agent 说「抓一下我抖音的数据」就行了。

**这份东西不会拿到你的任何隐私**：全程只读你自己账号的后台，数据只存在你自己电脑上，
不上传任何地方。别人给你的包里也没有他的数据——他发之前是过滤过的。

---

## 一、装什么

| | |
|---|---|
| **Node.js 22+** | 唯一需要装的东西。到 nodejs.org 下 LTS 版，**Windows 和 Mac 的安装包是分开的**，Mac 还要认芯片（M 系列 ARM64 / 老 Intel 机 x64）|
| **Chrome 或 Edge** | 一般都有 |
| **支持 MCP 的 Agent** | Claude Code / WorkBuddy / Codex / Cursor / Cline… |
| **抖音号 + 创作者中心权限** | 数据来源 |

**不需要** `npm install`，不需要装任何第三方包——MCP server 本身也是零依赖手写的。

---

## 二、怎么接

### 最省事：让你的 Agent 自己装

不用懂配置、不用找设置在哪。跑一次 `node scripts/install-mcp.mjs`（**启动菜单里就是选项 5**），
它会把你这台机器的绝对路径算好，打印一段话——**整段复制，粘到你 AI 的对话框里发出去**：

```
请帮我装一个 MCP server，名字叫 douyin。

它是本地 stdio 类型，启动方式是：
  命令：（脚本会填上你这台机器的 node 路径）
  参数：（脚本会填上这份工具的位置）

如果你能直接改自己的 MCP 配置，就自己改完；
如果你改不了，就告诉我该在哪个界面的哪个输入框里填什么。
```

它自己去配。**Claude Code、WorkBuddy、Cursor 都适用**——它们本来就是干这个的。

> ⚠️ **关于 `npx -y github:wytnzs/douyin-data-mcp` 那种写法**
> 看着最省事，但**靠不住**：npx 对一个 github 来源的包每次都去 codeload.github.com
> 重新下载，本地缓存不顶用（实测：npm 离线模式下直接报 ENOTCACHED）。
> **学员那边 GitHub 一断，MCP 就起不来。**
> 所以本工具默认推荐指向**本机路径**——不联网、不用装任何东西。
> `node scripts/install-mcp.mjs` 会把路径替你算好。

### 一行命令（Claude Code 这类带命令行工具的）

这个 MCP server 已经发在 GitHub 上：**https://github.com/wytnzs/douyin-data-mcp**

把下面这段贴进你的 MCP 配置就行：

```json
{
  "mcpServers": {
    "douyin": {
      "command": "npx",
      "args": ["-y", "github:wytnzs/douyin-data-mcp"]
    }
  }
}
```

**不用写任何路径**，复制粘贴即可。

**Claude Code** 用这一行：

```
claude mcp add douyin -s user -- npx -y github:wytnzs/douyin-data-mcp
```

- `-s user` = 所有项目都能用；`-s local` = 只对当前项目生效
- 加完重启 Claude Code，用 `/mcp` 能看到 `douyin` 连着
- 卸载：`claude mcp remove douyin -s user`

**WorkBuddy**：插件面板 → **MCP** → 添加，把上面那段 JSON 贴进去。

**Cursor / Cline / Codex / Claude Desktop 等**：填进各自的 MCP 设置，格式一样。

### 另一种：接本地这份

想用本地这份（改代码时用得上），跑：

```
node scripts/mcp-config.mjs
```

它会算出你这台机器上的绝对路径，打印出各客户端的配置。

> 本地用法要写绝对路径，JSON 里 Windows 的反斜杠得写成 `\\`——`mcp-config.mjs` 替你转好了。
>
> **两种用法的唯一区别是数据放哪**：npx 装的放 `~/.douyin-data/data/`（因为 npx 的代码在缓存里，
> 随时会被清掉，数据不能放那儿）；本地这份就放在工具目录里。
>
> 想指定别的位置有三种办法：启动菜单里按 **4** 改（会记进配置文件，下次启动还在，界面也会显示当前路径）；
> 设环境变量 `DOUYIN_DATA_DIR`（临时覆盖）；或者直接编辑 `~/.douyin-data/config.json`。

### ⚠️ 不要找别人要他的配置文件

MCP 配置里是绝对路径，指向的是**他的**电脑。你填了必然连不上。
用 npx 那种写法就没这个问题——里面一个路径都没有。

---

## 三、接上之后 Agent 多了 6 个工具

| 工具 | 干什么 | Agent 什么时候会调 |
|---|---|---|
| `douyin_status` | 看状态：浏览器跑没跑、抖音登录没登录（以及是哪个号）、今天抓过没、总表多少行 | 每次开始前先看一眼。**只读，不改任何东西** |
| `douyin_check` | 环境自检，缺什么说什么 | 状态不对时排查；带 `launch=true` 会把专用浏览器开起来 |
| `douyin_fetch` | 抓取 + 双向校验，但**不并表** | 想先验数据、再决定要不要入库时 |
| `douyin_merge` | 把快照并进总表 + 重出总览 | `douyin_fetch` 校验通过之后 |
| `douyin_daily` | 抓取 → 校验 → 并表 → 总览 → 日志，一条命令全做完 | **日常就用这个** |
| `douyin_data` | 读总表数据（可按日期筛、按播放排序） | 让它做复盘分析时 |

### 典型对话

> **你**：抓一下我抖音的数据，然后告诉我最近哪条表现最差。

Agent 的动作：`douyin_status`（看登录没）→ `douyin_daily`（跑全套）→ `douyin_data`（取数据）→ 给你结论。

> **你**：我这周抖音数据怎么样？

Agent：`douyin_status` → 读《抖音数据总览.md》 → 讲给你听。

---

## 四、第一次跑会发生什么

1. Agent 调 `douyin_daily`
2. 脚本**自动弹出**一个专用浏览器窗口，停在抖音创作者中心登录页
3. 工具返回 `needs_login: true`，Agent 会告诉你「请去浏览器窗口扫码」
4. 你扫码
5. 你再说一句「好了」，Agent 重新调一次，就抓完了

**扫码这一步机器代替不了，也不该代替。** 登录状态存在专用浏览器目录里，之后不用再扫。

> 为什么不直接用你日常那个浏览器：Chrome 136 起禁止对默认用户目录开调试端口，
> 所以必须用一个独立目录。好处是跟你日常浏览器完全隔离，代价就是第一次要单独登一次。

---

## 五、给 Agent 的提示词（可选）

大多数情况下不用特意教——工具描述本身已经写清楚了。如果想更稳，可以把这段放进 Agent 的
「项目说明 / 系统提示 / Rules」里：

```text
抖音数据抓取用 douyin-* 这一组 MCP 工具。规矩：
1. 先 douyin_status 看状态，再决定下一步。
2. 看到 needs_login 时，让用户本人去浏览器窗口扫码，不要尝试绕过或代替登录。
3. douyin_fetch / douyin_daily 的返回里 verified 必须是 true 才算数据可信；
   为 false 时停下来告诉用户，不要继续并表。
4. 报告要如实：不要把「已经执行」当成证据，校验码要真的对上。
5. 复盘时记住口径：播放量是累计值不是当日增量；指标截至 = 抓取日 − 1；
   单条整体完播率和单条涨粉后台没有接口，永远是空的，不要试图补。
```

---

## 六、出问题

| 现象 | 原因 | 怎么办 |
|---|---|---|
| Agent 说看不懂工具 / 没有工具 | MCP 没接上 | 跑 `node scripts/mcp-config.mjs` 重配；重启 Agent |
| 显示连不上、红叉 | 路径写错，或 Node 不在 | 命令里写 **node 的绝对路径**（`mcp-config.mjs` 会打印） |
| 工具一直返回 `needs_login` | 没扫码，或登录态过期 | 去浏览器窗口扫一次码 |
| 弹不出浏览器窗口 | 专用浏览器没起来 | 让 Agent 调 `douyin_check(launch=true)` |
| 端口 9333 被占 | 极少数情况 | 设环境变量 `DOUYIN_CDP_PORT` 换个端口再重启 Agent |
| 换了工具目录后就不灵了 | 配置里是绝对路径 | 重新跑 `node scripts/mcp-config.mjs --install` |

---

## 七、只读边界

给 Agent 的工具**全部是只读或本地写**，没别的：

- 只读你自己账号的创作者后台，**不发布、不改后台、不碰别人**
- 数据只写在你本机（`抖音作品数据.csv` 和 `raw/`），不上传任何地方
- **没有**任何替用户登录的能力——登录必须本人扫码
- 抓到的数据不会发给任何外部服务

Agent 每次跑之前都会先 `douyin_status`，你也能随时问它「现在什么状态」。
