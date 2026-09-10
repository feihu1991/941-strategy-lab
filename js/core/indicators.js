/*
 * indicators.js — 技术指标库（纯函数，预计算整个序列）
 * 所有函数返回与输入等长的数组，前置不足期用 null 填充
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Indicators = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** 简单移动平均 */
  function sma(values, n) {
    var out = new Array(values.length).fill(null);
    if (n <= 0) return out;
    var sum = 0;
    for (var i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  /** 指数移动平均 */
  function ema(values, n) {
    var out = new Array(values.length).fill(null);
    if (n <= 0) return out;
    var k = 2 / (n + 1), prev = null;
    for (var i = 0; i < values.length; i++) {
      if (i < n - 1) { prev = (prev === null ? values[i] : prev + values[i]); continue; }
      if (i === n - 1) {
        var s = 0;
        for (var j = 0; j <= i; j++) s += values[j];
        prev = s / n;
      } else {
        prev = values[i] * k + prev * (1 - k);
      }
      out[i] = prev;
    }
    return out;
  }

  /** 平均真实波幅 */
  function atr(bars, n) {
    var out = new Array(bars.length).fill(null);
    var tr = new Array(bars.length).fill(0);
    for (var i = 0; i < bars.length; i++) {
      if (i === 0) { tr[i] = bars[i].high - bars[i].low; continue; }
      var p = bars[i - 1].close;
      tr[i] = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - p), Math.abs(bars[i].low - p));
    }
    var sum = 0;
    for (var k = 0; k < bars.length; k++) {
      sum += tr[k];
      if (k >= n) sum -= tr[k - n];
      if (k >= n - 1) out[k] = sum / n;
    }
    return out;
  }

  /** 相对强弱指标 */
  function rsi(closes, n) {
    var out = new Array(closes.length).fill(null);
    if (closes.length <= n) return out;
    var gain = 0, loss = 0;
    for (var i = 1; i <= n; i++) {
      var d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    var avgGain = gain / n, avgLoss = loss / n;
    out[n] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (var j = n + 1; j < closes.length; j++) {
      var ch = closes[j] - closes[j - 1];
      var g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (n - 1) + g) / n;
      avgLoss = (avgLoss * (n - 1) + l) / n;
      out[j] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }

  /** 滚动最高值（含当期） */
  function hhv(values, n) {
    var out = new Array(values.length).fill(null);
    for (var i = 0; i < values.length; i++) {
      if (i < n - 1) continue;
      var m = -Infinity;
      for (var j = i - n + 1; j <= i; j++) if (values[j] > m) m = values[j];
      out[i] = m;
    }
    return out;
  }

  /** 滚动最低值（含当期） */
  function llv(values, n) {
    var out = new Array(values.length).fill(null);
    for (var i = 0; i < values.length; i++) {
      if (i < n - 1) continue;
      var m = Infinity;
      for (var j = i - n + 1; j <= i; j++) if (values[j] < m) m = values[j];
      out[i] = m;
    }
    return out;
  }

  /**
   * 摆动结构点（fractal）：某根 K 线的高点在 i±k 范围内最高 → 结构高点
   * 返回点位数组 + 确认索引（confirmIdx = i + k，即该点在第 i+k 根才可被确认使用）
   */
  function swings(bars, k) {
    k = k || 2;
    var highs = [], lows = [];
    for (var i = 0; i < bars.length; i++) {
      if (i < k || i >= bars.length - k) continue;
      var h = bars[i].high, l = bars[i].low, isH = true, isL = true;
      for (var j = -k; j <= k; j++) {
        if (j === 0) continue;
        if (bars[i + j].high >= h) isH = false;
        if (bars[i + j].low <= l) isL = false;
        if (!isH && !isL) break;
      }
      if (isH) highs.push({ idx: i, price: h, confirmIdx: i + k });
      if (isL) lows.push({ idx: i, price: l, confirmIdx: i + k });
    }
    return { highs: highs, lows: lows };
  }

  /** 序列回撤（水下曲线，<=0） */
  function drawdown(values) {
    var peak = -Infinity, out = new Array(values.length).fill(0);
    for (var i = 0; i < values.length; i++) {
      if (values[i] > peak) peak = values[i];
      out[i] = peak > 0 ? values[i] / peak - 1 : 0;
    }
    return out;
  }

  /** 滚动标准差（用于波动率） */
  function stdev(values, n) {
    var out = new Array(values.length).fill(null);
    for (var i = n - 1; i < values.length; i++) {
      var mean = 0;
      for (var j = i - n + 1; j <= i; j++) mean += values[j];
      mean /= n;
      var v = 0;
      for (var q = i - n + 1; q <= i; q++) v += Math.pow(values[q] - mean, 2);
      out[i] = Math.sqrt(v / n);
    }
    return out;
  }

  /** 日收益率序列 */
  function returns(values) {
    var out = new Array(values.length).fill(0);
    for (var i = 1; i < values.length; i++) {
      out[i] = values[i - 1] > 0 ? values[i] / values[i - 1] - 1 : 0;
    }
    return out;
  }

  return { sma: sma, ema: ema, atr: atr, rsi: rsi, hhv: hhv, llv: llv,
           swings: swings, drawdown: drawdown, stdev: stdev, returns: returns };
});