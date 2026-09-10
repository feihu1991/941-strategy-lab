/*
 * rsiReversal.js — RSI 反转策略（震荡/逆势对照）
 * RSI 从超卖区回升买入；进入超买区或跌破离场线卖出
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StrategyRsiReversal = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return {
    id: "rsiReversal",
    name: "RSI 超卖反转",
    short: "RSI",
    desc: "RSI 自超卖区回升买入，进入超买区或跌破离场线卖出（逆势/震荡对照策略）",
    params: [
      { key: "rsiN", label: "RSI 周期", min: 5, max: 40, step: 1, def: 14 },
      { key: "oversold", label: "超卖线", min: 10, max: 45, step: 1, def: 30 },
      { key: "overbought", label: "超买线", min: 55, max: 90, step: 1, def: 70 },
      { key: "atrN", label: "ATR 周期", min: 5, max: 40, step: 1, def: 14 },
      { key: "stopAtr", label: "止损(ATR倍数)", min: 0, max: 6, step: 0.1, def: 2.5 }
    ],
    create: function (p, ind) {
      var r = ind.rsi(p.rsiN), atrArr = ind.atr(p.atrN);
      return {
        onBar: function (ctx) {
          var i = ctx.i;
          if (i === 0 || r[i] === null || r[i - 1] === null) return;
          var upFromOversold = r[i - 1] < p.oversold && r[i] >= p.oversold;
          var overbought = r[i] >= p.overbought;

          if (ctx.position) {
            if (overbought) ctx.sell("RSI 超买");
          } else if (upFromOversold) {
            var stop = (p.stopAtr > 0 && atrArr[i] !== null) ? ctx.bar.close - p.stopAtr * atrArr[i] : null;
            ctx.buy({ stop: stop });
          }
        }
      };
    }
  };
});