/*
 * strategy.js — “941 冠军策略”（价格行为循环）的机械化回测近似
 * 原作者: Oliver Kell（2022 年交易锦标赛 941.1% 收益）
 * 本实现为研究用途的常见近似: 趋势过滤 + 结构突破入场 + ATR 止损 + 追踪/止盈退出
 * 免责声明: 非原作者原版, 过去表现不代表未来收益
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Strategy941 = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- 指标 ----------
  function smaAt(closes, idx, n) {
    if (idx + 1 < n) return null;
    var s = 0;
    for (var i = idx - n + 1; i <= idx; i++) s += closes[i];
    return s / n;
  }

  function atrAt(bars, idx, n) {
    if (idx < 1) return null;
    var start = Math.max(1, idx - n + 1);
    var s = 0;
    for (var i = start; i <= idx; i++) {
      var p = bars[i - 1].close;
      var tr = Math.max(bars[i].high - bars[i].low,
        Math.abs(bars[i].high - p), Math.abs(bars[i].low - p));
      s += tr;
    }
    return s / (idx - start + 1);
  }

  // ---------- Swing fractal (i±2 结构点) ----------
  function computeSwings(bars) {
    var highs = [], lows = [];
    for (var i = 0; i < bars.length; i++) {
      if (i >= 2 && i < bars.length - 2) {
        var h = bars[i].high, l = bars[i].low, isH = true, isL = true;
        for (var j = -2; j <= 2; j++) {
          if (j === 0) continue;
          if (bars[i + j].high >= h) isH = false;
          if (bars[i + j].low <= l) isL = false;
        }
        highs[i] = isH ? h : null;
        lows[i] = isL ? l : null;
      } else {
        highs[i] = null; lows[i] = null;
      }
    }
    return { highs: highs, lows: lows };
  }

  // ---------- 主回测 ----------
  /**
   * @param rows 来自行情接口的数组: [date, open, close, high, low, volume]
   * @param opts 可选: { atrN, smaFast, smaSlow, stopAtr, takeProfitR, feeOpen, feeClose }
   */
  function backtest(rows, opts) {
    opts = opts || {};
    var atrN = opts.atrN || 14;
    var smaFast = opts.smaFast || 50;
    var smaSlow = opts.smaSlow || 200;
    var stopAtr = opts.stopAtr || 2.5;       // 初始止损 = 入场价 - stopAtr*ATR
    var takeProfitR = opts.takeProfitR || 3; // 盈利 3R 止盈
    var feeOpen = opts.feeOpen || 0.0008;    // 开仓费率
    var feeClose = opts.feeClose || 0.0015;  // 平仓费率(含印花税近似)

    var bars = rows.map(function (r) {
      return {
        date: r[0],
        open: +r[1], close: +r[2], high: +r[3], low: +r[4], volume: +r[5]
      };
    });
    if (bars.length < smaSlow + 60) return null;

    var closes = bars.map(function (b) { return b.close; });
    var swings = computeSwings(bars);

    // 已确认的最新结构点（无未来函数: 在 i 时只使用 i-2 及之前确认的）
    var lastSwingHigh = null; // 值
    var lastSwingLow = null;  // 值

    var equity = 1.0;
    var pos = null; // { entryIdx, entryPrice, stop, R }
    var sameBarBlock = false; // 平仓当日禁止再开仓
    var usedBreakout = null;  // 已用过的突破结构点(防止同日/同点反复入场)
    var trades = [];
    var eqCurve = [];
    var signals = []; // { date, type, price }

    for (var i = 0; i < bars.length; i++) {
      // 1) 结构确认: j = i-2 的 fractal 此时可以确认
      var j = i - 2;
      if (j >= 2) {
        if (swings.highs[j] !== null) lastSwingHigh = swings.highs[j];
        if (swings.lows[j] !== null) lastSwingLow = swings.lows[j];
      }

      var b = bars[i];
      var atrV = atrAt(bars, i, atrN);

      // 2) 持仓中的追踪止损: 新的结构低点高于当前止损 -> 上移
      if (pos && lastSwingLow !== null && lastSwingLow > pos.stop) {
        pos.stop = lastSwingLow;
      }

      // 3) 平仓判断 (收盘价)
      if (pos) {
        var R = pos.R;
        var hitStop = b.close <= pos.stop;
        var hitTarget = b.close >= pos.entryPrice + takeProfitR * R;
        if (hitStop || hitTarget) {
          var ret = (b.close / pos.entryPrice - 1) - feeClose;
          equity *= (b.close / pos.entryPrice) * (1 - feeClose);
          trades.push({
            entryDate: pos.date, exitDate: b.date,
            entryPrice: pos.entryPrice, exitPrice: b.close,
            ret: ret, bars: i - pos.entryIdx,
            reason: hitTarget ? "止盈" : "止损/追踪"
          });
          signals.push({ date: b.date, type: "sell", price: b.close });
          // 平仓后本日禁止再入场, 且该突破点标记已用
          pos = null;
          sameBarBlock = true;
          usedBreakout = lastSwingHigh;
        }
      }

      // 4) 开仓判断 (收盘穿越 + 趋势过滤)
      var prevClose = i > 0 ? bars[i - 1].close : null;
      if (!pos && i >= smaSlow && prevClose !== null) {
        var fast = smaAt(closes, i, smaFast);
        var slow = smaAt(closes, i, smaSlow);
        var trendUp = b.close > slow && fast > slow;
        var isNewBreakout = lastSwingHigh !== null && lastSwingHigh !== usedBreakout;
        var breakout = isNewBreakout && prevClose <= lastSwingHigh && b.close > lastSwingHigh;
        if (trendUp && breakout && atrV !== null && !sameBarBlock) {
          pos = {
            entryIdx: i, date: b.date, entryPrice: b.close,
            stop: b.close - stopAtr * atrV
          };
          pos.R = b.close - pos.stop;
          equity *= (1 - feeOpen);
          signals.push({ date: b.date, type: "buy", price: b.close });
        }
      }
      if (!pos) sameBarBlock = false;

      // 5) 记录净值
      var eq = pos ? equity * (b.close / pos.entryPrice) : equity;
      eqCurve.push({ date: b.date, value: eq });
    }

    // 期末强平
    if (pos) {
      var last = bars[bars.length - 1];
      trades.push({
        entryDate: pos.date, exitDate: last.date,
        entryPrice: pos.entryPrice, exitPrice: last.close,
        ret: (last.close / pos.entryPrice - 1) - feeClose,
        bars: bars.length - 1 - pos.entryIdx, reason: "期末平仓"
      });
    }

    // ---------- 绩效统计 ----------
    var stats = calcStats(eqCurve, trades, bars);
    // 基准: 买入持有
    var b0 = bars[0].close, b1 = bars[bars.length - 1].close;
    var benchCurve = eqCurve.map(function (p, idx) {
      return { date: p.date, value: bars[idx].close / b0 };
    });
    var benchTotal = b1 / b0 - 1;
    var benchDD = maxDrawdown(benchCurve.map(function (p) { return p.value; }));
    var years = (bars.length - 1) / 252;

    return {
      symbol: null, name: null,
      bars: bars,
      equity: eqCurve,
      bench: benchCurve,
      trades: trades,
      signals: signals,
      stats: {
        totalReturn: equity - 1,
        annualReturn: Math.pow(equity, 1 / Math.max(years, 0.1)) - 1,
        maxDrawdown: stats.maxDrawdown,
        winRate: stats.winRate,
        profitFactor: stats.profitFactor,
        tradeCount: trades.length,
        avgHoldBars: stats.avgHoldBars,
        benchTotal: benchTotal,
        benchDD: benchDD
      }
    };
  }

  function maxDrawdown(values) {
    var peak = -Infinity, mdd = 0;
    for (var i = 0; i < values.length; i++) {
      if (values[i] > peak) peak = values[i];
      var dd = peak > 0 ? (values[i] - peak) / peak : 0;
      if (dd < mdd) mdd = dd;
    }
    return mdd;
  }

  function calcStats(eqCurve, trades, bars) {
    var mdd = maxDrawdown(eqCurve.map(function (p) { return p.value; }));
    var wins = trades.filter(function (t) { return t.ret > 0; });
    var losses = trades.filter(function (t) { return t.ret <= 0; });
    var avgWin = wins.length ? wins.reduce(function (a, t) { return a + t.ret; }, 0) / wins.length : 0;
    var avgLoss = losses.length ? losses.reduce(function (a, t) { return a + t.ret; }, 0) / losses.length : 0;
    var avgHold = trades.length ? trades.reduce(function (a, t) { return a + t.bars; }, 0) / trades.length : 0;
    return {
      maxDrawdown: mdd,
      winRate: trades.length ? wins.length / trades.length : 0,
      profitFactor: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : (avgWin > 0 ? 99 : 0),
      avgHoldBars: Math.round(avgHold)
    };
  }

  // ---------- 股票代码规范化 (腾讯接口) ----------
  function normalizeSymbol(input) {
    var s = (input || "").trim().toLowerCase().replace(/\.(ss|sz|sh)$/i, "");
    if (/^us/i.test(s)) return s; // usAAPL
    if (/^\d{6}$/.test(s)) {
      if (s[0] === "6" || s[0] === "9" || s[0] === "5") return "sh" + s;
      return "sz" + s;
    }
    if (/^sh|^sz/.test(s)) return s;
    if (/^[a-z]{1,5}$/.test(s)) return "us" + s.toUpperCase();
    return s;
  }

  function symbolToMarket(s) {
    return /^us/i.test(s) ? "美股" : (s[0] === "s" && s[1] === "h" ? "沪市" : "深市");
  }

  return {
    backtest: backtest,
    normalizeSymbol: normalizeSymbol,
    symbolToMarket: symbolToMarket
  };
});