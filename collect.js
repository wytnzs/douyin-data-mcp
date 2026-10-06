/* collect.js —— 抖音创作者后台取数脚本（浏览器端）
 *
 * 运行位置：已登录的 https://creator.douyin.com 页面内
 * 边界：只读自己账号的数据，不发布、不改后台、不代替登录
 *
 * 用法（由 scripts/fetch.mjs 自动执行，无需手工粘贴）：
 *   在页面里执行本文件全文，然后轮询 window.__DY_STATUS__
 *
 * 结果寄存：window.__DY__       （JSON 字符串，供外部原样取走）
 *           window.__DY_SHA16__ （该字符串的 sha256 前 16 位）
 */
(async () => {
  const STATUS = { state: "RUNNING", done: 0, total: 0, note: "", error: null };
  window.__DY_STATUS__ = STATUS;
  window.__DY__ = null;
  window.__DY_SHA16__ = null;

  const DAY = 86400000;
  const RANGE_DAYS = 365;          // 拉取分析接口的时间窗
  const MAX_PAGES = 20;            // 作品清单最多翻 20 页（每页 50，够 1000 条）
  const PAGE_SIZE = 50;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 每个请求最多 3 次，间隔 500ms（后台接口偶发限流）
  async function req(url, init, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, Object.assign({ credentials: "include" }, init));
        const text = await r.text();
        if (r.status !== 200) throw new Error("HTTP " + r.status);
        return text;
      } catch (e) {
        lastErr = e;
        if (i < tries - 1) await sleep(500);
      }
    }
    throw lastErr;
  }

  const ymd = (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  };
  const ymdDash = (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };

  const fail = (msg) => { STATUS.state = "ERROR"; STATUS.error = msg; };

  try {
    const now = new Date();
    const start = ymd(new Date(now.getTime() - RANGE_DAYS * DAY));
    const end = ymd(now);

    // ---- 0. 先确认登录态 ------------------------------------------------
    // 未登录时接口返回 HTTP 200 + status_code 8 + status_msg「用户未登录」，
    // 只看 HTTP 状态码会把「没登录」误判成「登录了但没作品」。
    let account = null;
    try {
      const j = JSON.parse(await req("/web/api/media/user/info/"));
      if (j.status_code === 8) return fail("未登录：请在弹出的浏览器窗口里扫码登录抖音创作者中心，然后重跑。");
      if (j.status_code !== 0) return fail(`取账号信息失败：status_code=${j.status_code} ${j.status_msg || ""}`);
      const u = j.user || {};
      account = {
        nickname: u.nickname || "",
        uid: u.uid || "",
        unique_id: u.unique_id || u.short_id || "",
        follower_count: u.follower_count,
        aweme_count: u.aweme_count,
        total_favorited: u.total_favorited,
      };
    } catch (e) {
      // 账号信息拿不到不致命，继续抓作品
      account = null;
    }

    // ---- 1. 作品清单（分页）---------------------------------------------
    const awemes = [];
    let cursor = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const text = await req(
        "/janus/douyin/creator/pc/work_list?status=0&count=" + PAGE_SIZE +
          "&max_cursor=" + cursor +
          "&scene=star_atlas&device_platform=android&aid=1128"
      );
      const j = JSON.parse(text);
      if (j.status_code === 8) return fail("未登录：登录态已失效，请重新扫码后重跑。");
      if (j.status_code !== 0) return fail(`work_list 返回异常：status_code=${j.status_code} ${j.status_msg || ""}`);
      const list = j.aweme_list || j.items || [];
      awemes.push.apply(awemes, list);
      STATUS.done = awemes.length;
      if (!j.has_more || !list.length) break;
      cursor = j.max_cursor || 0;
      if (!cursor) break;
      await sleep(300);
    }

    if (!awemes.length) {
      return fail("登录正常，但作品清单是空的 —— 这个账号可能还没发过作品。");
    }

    STATUS.total = awemes.length;
    STATUS.note = "已取作品清单 " + awemes.length + " 条，开始补深度指标";

    // ---- 2. 深度指标（完播率 / 跳出率 / 平均播放秒）---------------------
    // 先取垂类，分析接口必须带这个参数，否则返回空
    let verticals = [];
    try {
      const v = JSON.parse(
        await req("/janus/douyin/creator/data/item_analysis/involved_vertical?start_date=" + start + "&end_date=" + end)
      );
      verticals = v.primary_verticals || [];
    } catch (e) {
      verticals = [];
    }

    const perfBy = {};
    try {
      const text = await req("/janus/douyin/creator/data/item_analysis/item_performance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          start_date: start,
          end_date: end,
          genres: [1, 2, 3, 4, 5, 8],
          primary_verticals: verticals,
          metric_type: 1,
        }),
      });

      // item_id 是 int64，JSON.parse 会丢精度 —— 从原始文本按序正则取出
      const rawIds = [];
      const re = /"item_id":(\d+)/g;
      let m;
      while ((m = re.exec(text)) !== null) rawIds.push(m[1]);

      const j = JSON.parse(text);
      const items = j.items || [];
      items.forEach((it, i) => {
        const id = rawIds[i] || String(it.item_id);
        perfBy[id] = it;
      });
    } catch (e) {
      STATUS.note = "深度指标接口失败，本次只落基础指标：" + String(e);
    }

    // ---- 3. 账号级总览 -------------------------------------------------
    let dashboard = null, fans = null;
    try {
      dashboard = JSON.parse(
        await req("/janus/douyin/creator/data/overview/dashboard", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recent_days: 7 }),
        })
      );
    } catch (e) {}
    try {
      fans = JSON.parse(await req("/janus/douyin/creator/data/overview/dashboard/fans?recent_days=7"));
    } catch (e) {}

    // ---- 4. 规范化 ------------------------------------------------------
    const captureDate = ymdDash(now);
    const metricsAsof = ymdDash(new Date(now.getTime() - DAY)); // 实测：指标截至 = 抓取日 − 1

    const records = awemes.map((a) => {
      const st = a.statistics || {};
      const awemeId = String(a.aweme_id || a.item_id);
      const p = perfBy[awemeId] || {};
      const dur = Number(a.duration || (a.video && a.video.duration) || 0) / 1000;
      const pct = (v) => (v === undefined || v === null ? "" : (v * 100).toFixed(2));

      // 作品类型：图文作品没有时长、也没有描述，深度指标接口也不收录
      const isImage = Array.isArray(a.images) && a.images.length > 0;
      const mediaType = isImage ? "图文" : a.video ? "视频" : "其他";

      // 标题兜底：desc → item_title → caption → 占位
      const rawTitle = String(a.desc || a.item_title || a.caption || "").replace(/\s+/g, " ").trim();
      const title = rawTitle || `（${mediaType}作品·后台无标题）`;

      return {
        capture_date: captureDate,
        aweme_id: awemeId,
        title: title,
        publish_date: a.create_time ? ymdDash(new Date(Number(a.create_time) * 1000)) : "",
        duration_sec: dur ? dur.toFixed(1) : "",
        view: st.play_count !== undefined ? st.play_count : "",
        like: st.digg_count !== undefined ? st.digg_count : "",
        comment: st.comment_count !== undefined ? st.comment_count : "",
        share: st.share_count !== undefined ? st.share_count : "",
        collect: st.collect_count !== undefined ? st.collect_count : "",
        completion_rate_pct: "",                       // 后台未开放单条整体完播率
        completion_rate_5s_pct: pct(p.completion_rate_5s),
        bounce_rate_2s_pct: pct(p.bounce_rate_2s),
        avg_view_sec: p.average_play_duration !== undefined ? Number(p.average_play_duration).toFixed(2) : "",
        fan_gain: "",                                  // 后台未开放单条涨粉
        metrics_asof: Object.keys(p).length ? metricsAsof : "",
        media_type: mediaType,
      };
    });

    const payload = JSON.stringify({
      _meta: {
        source: "creator.douyin.com",
        captured_at: now.toISOString(),
        capture_date: captureDate,
        range: [start, end],
        aweme_count: records.length,
        perf_matched: Object.keys(perfBy).length,
        verticals: verticals,
        account: account,
      },
      records: records,
      dashboard: dashboard,
      fans: fans,
    });

    // ---- 5. 校验码 ------------------------------------------------------
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    const sha16 = Array.from(new Uint8Array(buf))
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);

    window.__DY__ = payload;
    window.__DY_SHA16__ = sha16;
    STATUS.state = "DONE";
    STATUS.bytes = new TextEncoder().encode(payload).length;
    STATUS.sha16 = sha16;
    STATUS.note = "完成";
  } catch (e) {
    STATUS.state = "ERROR";
    STATUS.error = String((e && e.message) || e);
  }
})();
