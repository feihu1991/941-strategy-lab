/*
 * dualMA.js — 双均线趋势策略（经典对照）
 * 快线上穿慢线买入，下穿卖出；可选 ATR 止损
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StrategyDualMA = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return {
    id: "dualMA",
    name: "双均线交叉",
    short: "双均线",
    desc: "快均线上穿慢均线买入，下穿卖出；可叠加 ATR 止损（经典趋势跟随对照）",
    params: [
      { key: "fast", label: "快均线", min: 3, max: 60, step: 1, def: 20 },
      { key: "slow", label: "慢均线", min: 10, max: 200, step: 5, def: 60 },
      { key: "atrN", label: "ATR 周期", min: 5, max: 40, step: 1, def: 14 },
      { key: "stopAtr", label: "止损(ATR倍数)", min: 0, max: 6, step: 0.1, def: 0 }
    ],
    create: function (p, ind) {
      var f = ind.sma(p.fast), s = ind.sma(p.slow), atrArr = ind.atr(p.atrN);
      return {
        onBar: function (ctx) {
          var i = ctx.i;
          if (f[i] === null || s[i] === null || i === 0) return;
          var pf = f[i - 1], ps = s[i - 1];
          if (pf === null || ps === null) return;
          var crossUp = pf <= ps && f[i] > s[i];
          var crossDown = pf >= ps && f[i] < s[i];

          if (ctx.position) {
            if (crossDown) ctx.sell("均线死叉");
          } else if (crossUp) {
            var stop = (p.stopAtr > 0 && atrArr[i] !== null) ? ctx.bar.close - p.stopAtr * atrArr[i] : null;
            ctx.buy({ stop: stop });
          }
        }
      };
    }
  };
});