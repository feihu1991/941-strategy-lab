/*
 * metrics.js — 绩效指标计算（专业口径，命名无歧义）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Metrics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TRADING_DAYS = 252;

  /** 最大回撤 + 持续期（交易日） */
  function maxDrawdown(values) {
    var peak = -Infinity, peakIdx = 0, mdd = 0, mddStart = 0, mddEnd = 0, curStart = 0;
    for (var i = 0; i < values.length; i++) {
      if (values[i] > peak) { peak = values[i]; peakIdx = i; curStart = i; }
      var dd = peak > 0 ? values[i] / peak - 1 : 0;
      if (dd < mdd) { mdd = dd; mddStart = curStart; mddEnd = i; }
    }
    return { value: mdd, startIdx: mddStart, endIdx: mddEnd, days: mddEnd - mddStart };
  }

  /**
   * 汇总绩效
   * @param equity 净值序列（从 1.0 或初始资金开始）
   * @param trades 交易记录 [{ret, bars, ...}]
   * @param bench  基准净值序列
   * @param opts   { riskFree: 年化无风险利率 }
   */
  function summarize(equity, trades, bench, opts) {
    opts = opts || {};
    var rf = opts.riskFree === undefined ? 0.0 : opts.riskFree;
    var n = equity.length;
    var years = Math.max((n - 1) / TRADING_DAYS, 1 / TRADING_DAYS);
    // 基准资金: 引擎传入 1.0(初始资金), 避免"首日即开仓"时把首日成本漏掉
    var base = opts.initial !== undefined ? opts.initial : equity[0];
    var total = equity[n - 1] / base - 1;
    var annual = Math.pow(equity[n - 1] / base, 1 / years) - 1;

    // 日收益 -> 波动率 / 夏普
    var rets = [];
    for (var i = 1; i < n; i++) rets.push(equity[i - 1] > 0 ? equity[i] / equity[i - 1] - 1 : 0);
    var mean = rets.reduce(function (a, b) { return a + b; }, 0) / Math.max(rets.length, 1);
    var variance = rets.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / Math.max(rets.length - 1, 1);
    var vol = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS);
    var sharpe = vol > 0 ? (annual - rf) / vol : 0;

    var dd = maxDrawdown(equity);
    var calmar = dd.value < 0 ? annual / Math.abs(dd.value) : 0;

    // 交易统计
    var wins = trades.filter(function (t) { return t.ret > 0; });
    var losses = trades.filter(function (t) { return t.ret <= 0; });
    var grossWin = wins.reduce(function (a, t) { return a + t.ret; }, 0);
    var grossLoss = Math.abs(losses.reduce(function (a, t) { return a + t.ret; }, 0));
    var avgWin = wins.length ? grossWin / wins.length : 0;
    var avgLoss = losses.length ? -grossLoss / losses.length : 0;

    // 暴露度：持仓交易日占比
    var holdingBars = trades.reduce(function (a, t) { return a + t.bars; }, 0);

    // 基准
    var benchTotal = null, benchDD = null, excess = null;
    if (bench && bench.length === n) {
      benchTotal = bench[n - 1] / base - 1;
      benchDD = maxDrawdown(bench).value;
      excess = total - benchTotal;
    }

    return {
      totalReturn: total,
      annualReturn: annual,
      maxDrawdown: dd.value,
      maxDrawdownDays: dd.days,
      volatility: vol,
      sharpe: sharpe,
      calmar: calmar,
      winRate: trades.length ? wins.length / trades.length : 0,
      payoffRatio: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : (avgWin > 0 ? Infinity : 0),
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
      avgWin: avgWin,
      avgLoss: avgLoss,
      tradeCount: trades.length,
      avgHoldBars: trades.length ? Math.round(holdingBars / trades.length) : 0,
      exposure: n > 1 ? holdingBars / (n - 1) : 0,
      benchTotal: benchTotal,
      benchDD: benchDD,
      excessReturn: excess,
      days: n
    };
  }

  /** 组合：等权合并多条净值序列（初始资金均分，按日再平衡到等权） */
  function combineEqualWeight(curves) {
    if (!curves.length) return null;
    var n = Math.min.apply(null, curves.map(function (c) { return c.length; }));
    var out = new Array(n);
    for (var i = 0; i < n; i++) {
      var sum = 0;
      for (var j = 0; j < curves.length; j++) sum += curves[j][i];
      out[i] = sum / curves.length;
    }
    return out;
  }

  /** 排序辅助：按指标排序（处理 Infinity/NaN） */
  function sortable(v) {
    if (v === Infinity) return Number.MAX_VALUE;
    if (v === -Infinity) return -Number.MAX_VALUE;
    return (typeof v === "number" && isFinite(v)) ? v : -Number.MAX_VALUE;
  }

  return { summarize: summarize, maxDrawdown: maxDrawdown, combineEqualWeight: combineEqualWeight, sortable: sortable, TRADING_DAYS: TRADING_DAYS };
});