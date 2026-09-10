/*
 * sources.js — 行情数据层（多源自动降级 + 内存缓存 + 并发限流）
 *   1) 腾讯 ifzq      A股前复权（国内最稳）
 *   2) 东方财富       A股/美股，交易所自动探测
 *   3) 新浪 quotes    A股兜底（JSONP，不复权）
 * 输出统一为 bars: [{date, open, close, high, low, volume}]
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DataSources = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TX_API = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
  var EM_API = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
  var FETCH_TIMEOUT = 8000;

  var cache = new Map();      // key: secid|years -> data
  var inflight = new Map();   // 去重：同一请求只发一次
  var MAX_CONCURRENT = 3;
  var running = 0;
  var queue = [];

  function schedule(fn) {
    return new Promise(function (resolve, reject) {
      queue.push({ fn: fn, resolve: resolve, reject: reject });
      drain();
    });
  }
  function drain() {
    while (running < MAX_CONCURRENT && queue.length) {
      var job = queue.shift();
      running++;
      job.fn().then(job.resolve, job.reject).then(function () {
        running--;
        drain();
      });
    }
  }

  // ---------- 代码解析（支持 A股 / 港股 / 美股） ----------
  function resolveSymbol(input) {
    var s = (input || "").trim();
    if (!s) return null;

    // 已带东财 secid: 1.600519 / 0.300750 / 105.AAPL / 116.00700（前缀 1-3 位）
    var m = s.match(/^(\d{1,3})\.([A-Za-z0-9]+)$/);
    if (m) {
      var pre = m[1], c = m[2];
      if (pre === "116") return { em: s, tx: "hk" + c, display: c, market: "HK", us: false };
      if (/^10[567]/.test(pre)) return { em: s, tx: "us" + c.toUpperCase(), display: c.toUpperCase(), market: "US", us: true };
      return { em: s, tx: (pre === "1" ? "sh" : "sz") + c, display: c, market: "A", us: false };
    }

    // 港股: hk00700 / 00700（5 位数字）
    var hk = s.match(/^hk(\d{5})$/i) || s.match(/^(\d{5})$/);
    if (hk) {
      var hc = hk[1];
      return { em: "116." + hc, tx: "hk" + hc, display: hc, market: "HK", us: false };
    }

    // 美股: usAAPL / AAPL（1-5 个字母）
    var usm = s.toLowerCase().match(/^(?:us)?([a-z]{1,5})$/);
    if (usm && !/^\d/.test(s)) {
      var uc = usm[1].toUpperCase();
      return { em: "105." + uc, tx: "us" + uc, display: uc, market: "US", us: true };
    }

    // A股: 6 位数字（可带 sh/sz 前缀）
    var num = s.replace(/^(sh|sz)/i, "").match(/^(\d{6})$/);
    if (num) {
      var code = num[1];
      var isSH = code[0] === "6" || code[0] === "9" || code[0] === "5";
      return { em: (isSH ? "1." : "0.") + code, tx: (isSH ? "sh" : "sz") + code, display: code, market: "A", us: false };
    }
    return null;
  }

  function dateRange(years) {
    var end = new Date();
    var beg = new Date(end.getTime() - years * 365 * 86400000);
    function f(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); }
    return { beg: f(beg), end: f(end) };
  }

  function fetchWithTimeout(url, ms, asJson) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return asJson === false ? r.text() : r.json();
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  // ---------- 源实现 ----------
  function fromTencent(res) {
    var url = TX_API + "?param=" + encodeURIComponent(res.tx + ",day,,,800,qfq");
    return fetchWithTimeout(url, FETCH_TIMEOUT).then(function (j) {
      if (!j || !j.data) throw new Error("腾讯: 无数据");
      var key = Object.keys(j.data)[0];
      if (!key) throw new Error("腾讯: 空响应");
      var d = j.data[key];
      var arr = d.qfqday || d.day;
      if (!arr || arr.length < 60) throw new Error("腾讯: 数据过少(" + (arr ? arr.length : 0) + ")");
      var bars = arr.map(function (x) {
        return { date: x[0], open: +x[1], close: +x[2], high: +x[3], low: +x[4], volume: +(x[5] || 0) };
      });
      var name = d.qt && d.qt[key] && d.qt[key][1] ? String(d.qt[key][1]) : res.display;
      return { name: name, code: key, bars: bars, source: "腾讯" };
    });
  }

  function fromEastmoney(res) {
    var r = dateRange(res.years);
    var candidates = [res.em];
    if (/^105\./.test(res.em)) candidates.push("106." + res.em.slice(4));
    else if (/^106\./.test(res.em)) candidates.push("105." + res.em.slice(4));

    var chain = Promise.reject(new Error("start"));
    candidates.forEach(function (sid) {
      chain = chain.catch(function () { return emOne(sid, res, r); });
    });
    return chain;
  }

  function emOne(secid, res, r) {
    var url = EM_API + "?secid=" + encodeURIComponent(secid) +
      "&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&beg=" + r.beg + "&end=" + r.end;
    return fetchWithTimeout(url, FETCH_TIMEOUT).then(function (j) {
      if (!j || !j.data || !j.data.klines || !j.data.klines.length) throw new Error("东财: 无数据");
      var bars = j.data.klines.map(function (line) {
        var p = line.split(",");
        return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5] };
      });
      if (bars.length < 60) throw new Error("东财: 数据过少");
      return { name: j.data.name || res.display, code: j.data.code || res.display, bars: bars, source: "东财" };
    });
  }

  function fromSina(res) {
    if (typeof document === "undefined") return Promise.reject(new Error("新浪: 仅浏览器可用"));
    var n = 800;
    var cb = "cb" + Math.random().toString(36).slice(2, 8);
    var url = "https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_=" + cb +
      "/CN_MarketDataService.getKLineData?symbol=" + res.tx + "&scale=240&ma=no&datalen=" + n;
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      var done = false;
      function cleanup() { try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); }
      window[cb] = function (arr) {
        done = true; cleanup();
        if (!arr || !arr.length) return reject(new Error("新浪: 无数据"));
        var bars = arr.map(function (x) {
          return { date: x.day, open: +x.open, close: +x.close, high: +x.high, low: +x.low, volume: +(x.volume || 0) };
        });
        resolve({ name: res.display, code: res.tx, bars: bars, source: "新浪(不复权)" });
      };
      s.onerror = function () { if (!done) { done = true; cleanup(); reject(new Error("新浪: 加载失败")); } };
      setTimeout(function () { if (!done) { done = true; cleanup(); reject(new Error("新浪: 超时")); } }, FETCH_TIMEOUT);
      s.src = url;
      document.head.appendChild(s);
    });
  }

  /**
   * 加载一只股票的日线
   * @returns Promise<{name, code, bars, source, display, us, years}>
   */
  function load(input, years) {
    var res = resolveSymbol(input);
    if (!res) return Promise.reject(new Error("无法识别代码: " + input));
    res.years = years || 3;
    var ck = res.em + "|" + res.years;
    if (cache.has(ck)) return Promise.resolve(cache.get(ck));
    if (inflight.has(ck)) return inflight.get(ck);

    var sources = res.us ? [fromEastmoney, fromTencent]
      : (res.market === "HK" ? [fromTencent, fromEastmoney] : [fromTencent, fromEastmoney, fromSina]);
    var errs = [];
    var job = schedule(function () {
      var chain = Promise.reject(new Error("start"));
      sources.forEach(function (fn) {
        chain = chain.catch(function (e) {
          if (e && e.message !== "start") errs.push(e.message);
          return fn(res);
        });
      });
      return chain.then(function (d) {
        d.display = res.display;
        d.us = res.us;
        d.years = res.years;
        d.input = input;
        cache.set(ck, d);
        return d;
      }).catch(function () {
        throw new Error("数据源均失败: " + errs.join("；"));
      });
    });
    inflight.set(ck, job);
    job.then(function () { inflight.delete(ck); }, function () { inflight.delete(ck); });
    return job;
  }

  function clearCache() { cache.clear(); }

  return {
    resolveSymbol: resolveSymbol,
    load: load,
    clearCache: clearCache,
    cacheSize: function () { return cache.size; }
  };
});