/*
 * priceAction.js — 941 冠军策略：价格行为循环（Oliver Kell, 2022 年 +941.1%）
 *
 * 机械化近似实现：
 *   1) 趋势过滤：收盘 > SMA(slow) 且 SMA(fast) > SMA(slow)
 *   2) 结构识别：i±k 摆动高低点，仅使用"已确认"的结构点（confirmIdx <= 当日）
 *   3) 突破入场：收盘上穿最新已确认结构高点
 *   4) 初始止损：入场价 − stopAtr × ATR，随后由结构低点追踪上移
 *   5) 止盈：达到 takeProfitR 倍 R 离场
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StrategyPriceAction = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  return {
    id: "priceAction",
    name: "941 价格行为循环",
    short: "941",
    desc: "趋势过滤 + 结构突破入场 + ATR 初始止损 + 结构低点追踪 + R 倍止盈（Oliver Kell 941% 冠军策略的机械化近似）",
    params: [
      { key: "smaFast", label: "快均线", min: 5, max: 120, step: 1, def: 50 },
      { key: "smaSlow", label: "慢均线", min: 20, max: 300, step: 5, def: 200 },
      { key: "atrN", label: "ATR 周期", min: 5, max: 40, step: 1, def: 14 },
      { key: "stopAtr", label: "止损(ATR倍数)", min: 0.5, max: 6, step: 0.1, def: 2.5 },
      { key: "takeProfitR", label: "止盈(R倍数)", min: 0, max: 10, step: 0.5, def: 3 },
      { key: "swingK", label: "结构灵敏度", min: 1, max: 5, step: 1, def: 2 }
    ],
    create: function (p, ind) {
      var fast = ind.sma(p.smaFast), slow = ind.sma(p.smaSlow);
      var atrArr = ind.atr(p.atrN), sw = ind.swings(p.swingK);
      // 已确认结构点指针（按 confirmIdx 推进，杜绝未来函数）
      var hiPtr = 0, loPtr = 0, lastHigh = null, lastLow = null;
      var inited = false;

      return {
        onBar: function (ctx) {
          var i = ctx.i;
          // 推进已确认结构点
          while (hiPtr < sw.highs.length && sw.highs[hiPtr].confirmIdx <= i) {
            lastHigh = sw.highs[hiPtr].price; hiPtr++;
          }
          while (loPtr < sw.lows.length && sw.lows[loPtr].confirmIdx <= i) {
            lastLow = sw.lows[loPtr].price; loPtr++;
          }
          if (!inited && slow[i] !== null) inited = true;
          if (!inited) return;

          var close = ctx.bar.close;
          var pos = ctx.position;

          if (pos) {
            // 结构低点抬升 → 追踪止损
            if (lastLow !== null && (pos.stop === null || lastLow > pos.stop)) {
              ctx.setStop(lastLow, "结构追踪");
            }
            // 止盈
            if (p.takeProfitR > 0 && pos.R !== null) {
              var target = pos.entryPrice + p.takeProfitR * pos.R;
              if (close >= target) { ctx.sell("止盈 " + p.takeProfitR + "R"); return; }
            }
          } else {
            var trendUp = slow[i] !== null && fast[i] !== null && close > slow[i] && fast[i] > slow[i];
            var prev = ctx.prev ? ctx.prev.close : null;
            var breakout = lastHigh !== null && prev !== null && prev <= lastHigh && close > lastHigh;
            if (trendUp && breakout && atrArr[i] !== null) {
              ctx.buy({ stop: close - p.stopAtr * atrArr[i] });
            }
          }
        }
      };
    }
  };
});