/*
 * donchian.js — 唐奇安通道突破（海龟交易法核心）
 * 收盘突破前 N 日最高价买入；跌破前 M 日最低价卖出；ATR 止损
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StrategyDonchian = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return {
    id: "donchian",
    name: "唐奇安通道突破",
    short: "唐奇安",
    desc: "收盘突破前 N 日最高价买入，跌破前 M 日最低价离场，ATR 止损（海龟交易法核心）",
    params: [
      { key: "entryN", label: "入场通道", min: 5, max: 100, step: 1, def: 20 },
      { key: "exitN", label: "离场通道", min: 3, max: 60, step: 1, def: 10 },
      { key: "atrN", label: "ATR 周期", min: 5, max: 40, step: 1, def: 14 },
      { key: "stopAtr", label: "止损(ATR倍数)", min: 0.5, max: 6, step: 0.1, def: 2 }
    ],
    create: function (p, ind) {
      var hh = ind.hhv(p.entryN), ll = ind.llv(p.exitN), atrArr = ind.atr(p.atrN);
      return {
        onBar: function (ctx) {
          var i = ctx.i;
          if (i === 0) return;
          // 使用前一根的通道值, 避免当期最高价包含自身(未来函数)
          var up = hh[i - 1], dn = ll[i - 1];
          var close = ctx.bar.close;

          if (ctx.position) {
            if (dn !== null && close < dn) ctx.sell("跌破离场通道");
          } else if (up !== null && close > up && atrArr[i] !== null) {
            ctx.buy({ stop: close - p.stopAtr * atrArr[i] });
          }
        }
      };
    }
  };
});