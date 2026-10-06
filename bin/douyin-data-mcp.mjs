#!/usr/bin/env node
/* bin/douyin-data-mcp.mjs —— npx 入口
 *
 * 为什么需要这一层：
 *   用 npx 装的时候，代码在 ~/.npm/_npx/<hash>/ 里，随时可能被 npm 清掉。
 *   数据（总表、快照、日志）绝不能写在那儿——用户会找不到自己的数据。
 *   所以这里在加载 server 之前，先把数据目录指到 ~/.douyin-data/data。
 *
 *   zip / git clone 的使用者不走这个入口，数据就放在工具目录里，符合直觉。
 *   想自己指定，设 DOUYIN_DATA_DIR 即可（这一层不会覆盖已有的值）。
 */
import os from "node:os";
import path from "node:path";

if (!process.env.DOUYIN_DATA_DIR) {
  process.env.DOUYIN_DATA_DIR = path.join(os.homedir(), ".douyin-data", "data");
}

await import("../scripts/mcp.mjs");
