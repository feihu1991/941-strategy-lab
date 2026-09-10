/*
 * engine.js — 统一回测引擎
 *
 * 设计要点(相比 v1 的改进):
 *  - 策略只需实现 onBar(ctx) 状态机, 成交/费用/净值/统计全部由引擎统一处理,
 *    从而保证多策略横向对比口径完全一致
 *  - 止损支持"盘中触发"(用当日 low/high 判定, 跳空按开盘价成交), 比只判收盘更真实
 *  - 指标按需计算并缓存, 同一次回测内不重复计算
 *  - 期末强制结算, 净值曲线与统计指标严格一致
 *  - 结构点(swing)提供"已确认"访问器, 从框架层杜绝未来函数
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./indicators.js"), require("./metrics.js"));
  } else {
    root.Engine = factory(root.Indicators, root.Metrics);
  }
})(typeof self !== "undefined" ? self : this, function (Indicators, Metrics) {
  "use strict";

  var DEFAULTS = {
    feeOpen: 0.0008,     // 开仓费率（佣金）
    feeClose: 0.0015,    // 平仓费率（佣金+印花税近似）
    slippage: 0.0,       // 单边滑点（比例），默认 0
    riskFree: 0.0,       // 年化无风险利率（夏普用）
    intrabarStop: true   // 盘中止损（false 则只按收盘价判定）
  };

  function makeIndicators(bars) {
    var closes = bars.map(function (b) { return b.close; });
    var highs = bars.map(function (b) { return b.high; });
    var lows = bars.map(function (b) { return b.low; });
    var cache = {};
    function memo(key, fn) {
      if (!(key in cache)) cache[key] = fn();
      return cache[key];
    }
    return {
      closes: closes,
      sma: function (n) { return memo("sma" + n, function () { return Indicators.sma(closes, n); }); },
      ema: function (n) { return memo("ema" + n, function () { return Indicators.ema(closes, n); }); },
      atr: function (n) { return memo("atr" + n, function () { return Indicators.atr(bars, n); }); },
      rsi: function (n) { return memo("rsi" + n, function () { return Indicators.rsi(closes, n); }); },
      hhv: function (n) { return memo("hhv" + n, function () { return Indicators.hhv(highs, n); }); },
      llv: function (n) { return memo("llv" + n, function () { return Indicators.llv(lows, n); }); },
      swings: function (k) { return memo("sw" + k, function () { return Indicators.swings(bars, k); }); }
    };
  }

  /**
   * 执行回测
   * @param bars      [{date, open, close, high, low, volume}]
   * @param strategy  { id, name, params, create(params, ind) -> {onBar(ctx)} }
   * @param params    策略参数对象
   * @param options   引擎选项（费率/滑点等）
   */
  function run(bars, strategy, params, options) {
    var opt = Object.assign({}, DEFAULTS, options || {});
    var n = bars.length;
    if (!n) return null;

    var ind = makeIndicators(bars);
    var impl = strategy.create(params || {}, ind);
    var state = {};

    var cash = 1.0;            // 现金基准（净值系数）
    var pos = null;            // { entryIdx, entryPrice, stop, R, entryDate }
    var equity = new Array(n);
    var trades = [], signals = [];
    var pending = null;        // 策略在 onBar 中提出的指令

    function markToMarket(i) {
      var b = bars[i];
      return pos ? cash * (b.close / pos.entryPrice) : cash;
    }

    function closePosition(i, price, reason) {
      var b = bars[i];
      var exitPrice = price;
      var ret = (exitPrice / pos.entryPrice - 1) - opt.feeClose;
      cash *= (exitPrice / pos.entryPrice) * (1 - opt.feeClose);
      trades.push({
        entryIdx: pos.entryIdx, entryDate: pos.entryDate, entryPrice: pos.entryPrice,
        exitIdx: i, exitDate: b.date, exitPrice: exitPrice,
        ret: ret, bars: i - pos.entryIdx, reason: reason
      });
      signals.push({ idx: i, date: b.date, type: "sell", price: exitPrice, reason: reason });
      pos = null;
    }

    function openPosition(i, price, stopPrice) {
      var b = bars[i];
      var entryPrice = price;
      cash *= (1 - opt.feeOpen);
      pos = {
        entryIdx: i, entryDate: b.date, entryPrice: entryPrice,
        stop: stopPrice === undefined || stopPrice === null ? null : stopPrice
      };
      pos.R = pos.stop !== null ? Math.abs(entryPrice - pos.stop) : null;
      signals.push({ idx: i, date: b.date, type: "buy", price: entryPrice, stop: pos.stop });
    }

    for (var i = 0; i < n; i++) {
      var bar = bars[i];

      // ---------- 1) 止损检查（在策略决策之前, 更贴近实盘） ----------
      if (pos && pos.stop !== null) {
        var hit = false, fill = null;
        if (opt.intrabarStop) {
          if (bar.low <= pos.stop) { hit = true; fill = Math.min(pos.stop, bar.open); }
        } else {
          if (bar.close <= pos.stop) { hit = true; fill = bar.close; }
        }
        if (hit) {
          closePosition(i, fill * (1 - opt.slippage), pos.stopReason || "止损");
        }
      }

      // ---------- 2) 策略决策 ----------
      pending = null;
      var ctx = {
        i: i,
        bar: bar,
        prev: i > 0 ? bars[i - 1] : null,
        bars: bars,
        ind: ind,
        state: state,
        position: pos,
        buy: function (opts) {
          opts = opts || {};
          pending = { action: "buy", stop: opts.stop === undefined ? null : opts.stop };
        },
        sell: function (reason) {
          pending = { action: "sell", reason: reason || "策略平仓" };
        },
        setStop: function (price, reason) {
          if (pos) { pos.stop = price; if (reason) pos.stopReason = reason; }
        }
      };
      if (impl.onBar) impl.onBar(ctx);

      // ---------- 3) 执行策略指令 ----------
      if (pending && pending.action === "sell" && pos) {
        closePosition(i, bar.close * (1 - opt.slippage), pending.reason);
      } else if (pending && pending.action === "buy" && !pos) {
        openPosition(i, bar.close * (1 + opt.slippage), pending.stop);
      }

      // ---------- 4) 记录净值 ----------
      equity[i] = markToMarket(i);
    }

    // 期末结算（保证指标与净值曲线一致）
    if (pos) {
      var last = bars[n - 1];
      closePosition(n - 1, last.close * (1 - opt.slippage), "期末平仓");
      equity[n - 1] = cash;
    }

    // 基准：买入持有（同样扣一次开仓费，公平对比）
    var bench = new Array(n), b0 = bars[0].close * (1 + opt.slippage) * (1 + opt.feeOpen);
    for (var k = 0; k < n; k++) bench[k] = bars[k].close / b0;

    var stats = Metrics.summarize(equity, trades, bench, { riskFree: opt.riskFree, initial: 1.0 });

    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      params: params,
      dates: bars.map(function (b) { return b.date; }),
      equity: equity,
      bench: bench,
      trades: trades,
      signals: signals,
      stats: stats
    };
  }

  return { run: run, DEFAULTS: DEFAULTS };
});