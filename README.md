# 抖音数据抓取 MCP

**把你抖音账号的作品数据抓下来，存成一张按天累积的本地表格。**

一个 MCP server，接给 Claude Code / WorkBuddy / Codex / Cursor 等任何支持 MCP 的 Agent 之后，
你只要说一句「抓一下我抖音的数据」，它自己干完。

> A zero-dependency MCP server that pulls your own Douyin (TikTok China) creator-analytics data
> into a local CSV, so your AI agent can track and review it for you.

**全程只读你自己账号的数据**：不发布、不改后台、不碰别人的内容、不代替你登录。
数据只存在你自己电脑上，不上传任何地方。

---

## 它抓什么

每条作品：播放、点赞、评论、分享、收藏、时长、发布日 —— 加上后台的深度指标：
**5 秒完播率、2 秒跳出率、平均播放秒**。另外还有账号级的近 7 天总览（封面点击率、净增粉丝、总粉丝…）。

产出三样东西：

| 文件 | 用途 |
|---|---|
| `抖音作品数据.csv` | 总表，按「抓取日期 + 作品ID」累积。复盘、看趋势都读它 |
| `抖音数据总览.md` | 展示表，日常看这个 |
| `抓取状态.md` | 日志，**数据不对先查这里** |

---

## 装

**需要 Node.js 22 或更高**（[nodejs.org](https://nodejs.org) 下 LTS 版）。没有别的依赖，
不用 `npm install`，不装任何第三方包。

### 方式一：npx（推荐，MCP 配置里不用写任何路径）

直接在你的 Agent 里加这段 MCP 配置：

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

**不用改路径，复制粘贴就行。**

### 方式二：下载 zip

下载仓库 zip 解压到任意位置，然后双击 `启动.bat`（macOS 是 `启动.command`）。
详细步骤看 [`docs/操作手册.md`](docs/操作手册.md)。

### 方式三：git clone

```
git clone https://github.com/wytnzs/douyin-data-mcp.git
cd douyin-data-mcp
node scripts/check.mjs --launch
```

然后跑 `node scripts/mcp-config.mjs` 生成属于你这台机器的 MCP 配置
（clone 的用法要把绝对路径填进配置，所以让脚本替你算）。

---

## 接给 Agent

### Claude Code

```bash
claude mcp add douyin -s user -- npx -y github:wytnzs/douyin-data-mcp
```

### 其他客户端

用上面「方式一」那段 JSON。WorkBuddy 在插件面板 → MCP 里加，Cursor / Cline 等填进自己的 MCP 设置。

### 接上之后 Agent 多了 6 个工具

| 工具 | 干什么 |
|---|---|
| `douyin_status` | 看状态：浏览器跑没跑、登录没、今天抓过没、总表多少行。只读 |
| `douyin_check` | 环境自检，缺什么说什么 |
| `douyin_fetch` | 抓取 + 校验，不并表 |
| `douyin_merge` | 并表 + 出总览 |
| `douyin_daily` | 抓取 → 校验 → 并表 → 总览 → 日志，全做完。**日常用这个** |
| `douyin_data` | 读总表数据，做复盘分析 |

然后你就可以说：

> 抓一下我抖音的数据，然后告诉我最近哪条表现最差。

---

## 不用 Agent 也能用

它同时也是普通命令行工具：

```bash
node scripts/check.mjs      # 环境自检
node scripts/daily.mjs      # 抓取 + 校验 + 并表 + 出总览 + 记日志
```

退出码：`0` 成功 / `1` 失败 / `3` 今天已抓过 / `4` **需要先登录**。

---

## 第一次跑会发生什么

1. 脚本**自动打开一个专用浏览器窗口**，停在抖音创作者中心登录页
2. 它返回「需要登录」，Agent 会转告你去扫码
3. 你用抖音 App 扫码
4. 再让它跑一次，就抓完了

**扫码这一步机器代替不了，也不该代替。** 登录状态存在专用浏览器目录里，之后免登。

> 为什么要单独一个浏览器：Chrome 136 起禁止对默认用户目录开调试端口，必须用独立目录
> （默认 `~/.douyin-data/browser-profile`）。好处是跟你日常浏览器完全隔离。

---

## 数据放在哪

| 用法 | 数据目录 |
|---|---|
| npx | `~/.douyin-data/data/` |
| zip / clone | 就是解压/克隆出来的那个目录 |
| 想自己指定 | 设环境变量 `DOUYIN_DATA_DIR` |

npx 的代码在缓存里（随时会被清掉），所以数据**不会**放那儿——你的数据永远是安全的。

---

## 已知边界

- **只读**：只访问你自己账号的创作者后台，不发布、不改后台
- **单条「整体完播率」和「单条涨粉」拿不到**——后台只开放到账号级，没有单条接口。这两列留空，**不做估算填充**
- **图文作品没有深度指标**——那套接口只算视频。表格里用 `media_type` 列区分
- **新作品当天没有完播率**——后台次日才算
- **指标截至 = 抓取日 − 1**，几点抓都一样
- **播放量是累计值，不是当日增量**——当日增量要用今天这行减上一天同一条

---

## 常见问题

**「扫码登录安全吗？」**
全程只读你自己账号的后台，数据只写在你本机，不上传任何地方。脚本没有任何替用户登录的能力。

**「弹窗说端口被占用 / 连不上」**
跑 `node scripts/check.mjs` 看缺什么。端口默认 9333，可以用环境变量 `DOUYIN_CDP_PORT` 换。

**「换电脑了要重新扫码吗？」**
要。登录状态在每台机器各自的 `~/.douyin-data/browser-profile` 里。

**「能定时自动跑吗？」**
能。接给 Agent 的用它的定时任务调 `douyin_daily`；不接就在系统计划任务里跑 `node scripts/daily.mjs`。
建议设在下午 1 点之后——后台的深度指标是次日才补齐的。

---

## 想改接口

数据来自抖音创作者后台的几个内部接口。接口清单、响应结构、以及三个容易踩的坑
（未登录返回 HTTP 200 + `status_code: 8`、`item_id` 是 int64 会丢精度、`involved_vertical` 必填），
都写在 [`docs/维护说明.md`](docs/维护说明.md)。

**接口变了只需要改 `collect.js`**，其它文件不用动。

零第三方依赖是刻意的：只用 Node 22+ 自带的 `fetch` 和原生 `WebSocket`，MCP 协议也是手写的，
不引官方 SDK。这样使用者不需要 `npm install`，双击就能跑。

---

## License

MIT © 2026 王永涛
