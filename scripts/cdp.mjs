/* cdp.mjs —— 零依赖的 Chrome DevTools 客户端
 *
 * 只做四件事：列标签页 / 新开标签页 / 在页面里执行 JS / 关标签页。
 * 用 Node 22+ 自带的 WebSocket 和 fetch，不引任何 npm 包。
 */
const DEFAULT_TIMEOUT = 30000;

/** 探测端口上是不是一个可用的 CDP 端点，返回版本信息或 null */
export async function probe(port, timeoutMs = 2500) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ac.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json();
    return j.webSocketDebuggerUrl ? j : null;
  } catch {
    return null;
  }
}

/** 列出全部标签页 */
export async function listPages(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!r.ok) throw new Error(`列标签页失败：HTTP ${r.status}`);
  const all = await r.json();
  return all.filter((t) => t.type === "page");
}

/** 新开一个标签页，返回它的 target 对象 */
export async function newPage(port, url = "about:blank") {
  // PUT 是 Chrome 新版要求的写法，兼容 GET
  let r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!r.ok) r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error(`新开标签页失败：HTTP ${r.status}`);
  return r.json();
}

/** 关闭标签页 */
export async function closePage(port, id) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/close/${id}`);
    return true;
  } catch {
    return false;
  }
}

/** 在指定标签页里执行 JS。
 *  awaitPromise=false（默认）时不等待 Promise，适合触发长任务后再轮询状态。
 */
export async function evaluate(port, pageId, expression, opts = {}) {
  const { awaitPromise = false, timeoutMs = DEFAULT_TIMEOUT } = opts;
  const pages = await listPages(port);
  const page = pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`标签页 ${pageId} 不在了（可能被关掉或页面被刷新）`);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`执行超时（${timeoutMs}ms）`));
    }, timeoutMs);

    const done = (fn, arg) => { clearTimeout(timer); try { ws.close(); } catch {} fn(arg); };

    ws.addEventListener("error", (e) => done(reject, new Error("WebSocket 错误：" + (e.message || "unknown"))));
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise, userGesture: true },
      }));
    });
    ws.addEventListener("message", (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== 1) return;
      if (m.error) return done(reject, new Error("CDP 错误：" + JSON.stringify(m.error)));
      const res = m.result || {};
      if (res.exceptionDetails) {
        const d = res.exceptionDetails;
        const msg = d.exception?.description || d.text || "页面里报错";
        return done(reject, new Error(msg.split("\n")[0]));
      }
      done(resolve, res.result?.value);
    });
  });
}

/** 等到页面文档加载完成 */
export async function waitForLoad(port, pageId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const s = await evaluate(port, pageId, "document.readyState");
      if (s === "complete") return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}
