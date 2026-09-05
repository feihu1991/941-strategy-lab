/*
 * data.js — 行情数据层 (多公共源自动切换, 免 key)
 *   首选: 东方财富 push2his (A股+美股, CORS 开放)
 *   备选: 腾讯 ifzq (A股前复权, CORS 开放)
 *   备选: 新浪 quotes.sina.cn (A股, JSONP)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Data941 = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EM_API = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
  var TX_API = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
  var FETCH_TIMEOUT = 8000; // 单源 8 秒超时, 快速降级下一源

  function fetchTimeout(url, ms) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (r) {
      if (timer) clearTimeout(timer);
      return r;
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  // ---------- 代码解析 ----------
  // 输入 -> { em, tx, display, us }   (em=东财secid, tx=腾讯代号)
  function resolveSymbol(input) {
    var s = (input || "").trim();
    if (!s) return null;
    var m = s.match(/^(\d{2,3})\.([A-Za-z0-9]+)$/);
    if (m) {
      var secidM = s;
      var codeM = m[2];
      return {
        em: secidM,
        tx: /^10[567]/.test(m[1]) ? "us" + codeM.toUpperCase() : (m[1] === "1" ? "sh" : "sz") + codeM,
        display: s, us: /^10[567]/.test(m[1])
      };
    }
    var lower = s.toLowerCase();
    var us = lower.match(/^(?:us)?([a-z]{1,5})$/);
    if (us && !/^\d/.test(s)) {
      var uc = us[1].toUpperCase();
      return { em: "105." + uc, tx: "us" + uc, display: uc, us: true };
    }
    var num = s.replace(/^(sh|sz)/, "").match(/^(\d{6})$/);
    if (num) {
      var code = num[1];
      var isSH = code[0] === "6" || code[0] === "9" || code[0] === "5";
      return { em: (isSH ? "1." : "0.") + code, tx: (isSH ? "sh" : "sz") + code, display: code, us: false };
    }
    return null;
  }

  function dateRange(years) {
    var end = new Date();
    var beg = new Date(end.getTime() - years * 365 * 86400000);
    function fmt(d) {
      return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    }
    return { beg: fmt(beg), end: fmt(end) };
  }

  function toRows(klines) {
    return klines.map(function (line) {
      var p = line.split(",");
      return [p[0], +p[1], +p[2], +p[3], +p[4], +p[5]];
    });
  }

  // ---------- 东方财富 ----------
  function fetchEM(res, years) {
    var r = dateRange(years);
    var url = EM_API + "?secid=" + encodeURIComponent(res.em) +
      "&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&beg=" + r.beg + "&end=" + r.end;
    return fetchTimeout(url, FETCH_TIMEOUT).then(function (resp) {
      if (!resp.ok) throw new Error("东财 HTTP " + resp.status);
      return resp.json();
    }).then(function (j) {
      if (!j.data || !j.data.klines || !j.data.klines.length) throw new Error("东财无数据");
      var rows = toRows(j.data.klines);
      if (rows.length < 60) throw new Error("东财数据过少");
      return { name: j.data.name || res.display, code: j.data.code || res.display, rows: rows };
    });
  }

  // ---------- 腾讯 (仅A股前复权可靠; 美股可能只有2条) ----------
  function fetchTX(res, years) {
    var url = TX_API + "?param=" + encodeURIComponent(res.tx + ",day,,,800,qfq");
    return fetchTimeout(url, FETCH_TIMEOUT).then(function (resp) {
      if (!resp.ok) throw new Error("腾讯 HTTP " + resp.status);
      return resp.json();
    }).then(function (j) {
      if (!j.data) throw new Error("腾讯无数据");
      var keys = Object.keys(j.data);
      if (!keys.length) throw new Error("腾讯无数据");
      var d = j.data[keys[0]];
      var arr = d.qfqday || d.day;
      if (!arr || arr.length < 60) throw new Error("腾讯数据过少");
      var rows = arr.map(function (x) { return [x[0], +x[1], +x[2], +x[3], +x[4], +(x[5] || 0)]; });
      var name = null;
      var qt = d.qt && d.qt[keys[0]];
      if (qt && qt[1]) name = String(qt[1]);
      return { name: name || res.display, code: keys[0], rows: rows };
    });
  }

  // ---------- 新浪 (仅浏览器, JSONP) ----------
  function fetchSina(res, years) {
    var n = Math.min(800, years * 254);
    var cb = "cb" + Math.random().toString(36).slice(2, 8);
    var url = "https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_=" + cb +
      "/CN_MarketDataService.getKLineData?symbol=" + res.tx + "&scale=240&ma=no&datalen=" + n;
    return jsonp(url, cb).then(function (arr) {
      if (!arr || !arr.length) throw new Error("新浪无数据");
      var rows = arr.map(function (x) {
        return [x.day, +x.open, +x.close, +x.high, +x.low, +(x.volume || 0)];
      });
      return { name: res.display, code: res.tx, rows: rows };
    });
  }

  function jsonp(url, cbName) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      var done = false;
      window[cbName] = function (data) {
        done = true;
        resolve(data);
        cleanup();
      };
      function cleanup() {
        delete window[cbName];
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      s.onerror = function () {
        if (!done) { done = true; cleanup(); reject(new Error("JSONP 失败")); }
      };
      setTimeout(function () {
        if (!done) { done = true; cleanup(); reject(new Error("JSONP 超时")); }
      }, 8000);
      s.src = url;
      document.head.appendChild(s);
    });
  }

  // ---------- 主入口: 多源切换 ----------
  // 注意: 东财对高频请求有风控(连接重置), 按源顺序降级; 收集各源错误便于诊断
  function loadSymbol(input, years) {
    var res = resolveSymbol(input);
    if (!res) return Promise.reject(new Error("无法识别代码: " + input));
    var sources = res.us ? [fetchEM, fetchTX] : [fetchTX, fetchEM, fetchSina];
    var errs = [];
    var chain = Promise.reject(new Error("start"));
    sources.forEach(function (fn) {
      chain = chain.catch(function (e) {
        if (e && e.message !== "start") errs.push(e.message);
        return fn(res, years);
      });
    });
    return chain.then(function (d) {
      d.display = res.display;
      d.us = res.us;
      return d;
    }).catch(function (e) {
      throw new Error("数据源均失败: " + errs.join("；"));
    });
  }

  return { resolveSymbol: resolveSymbol, loadSymbol: loadSymbol };
});