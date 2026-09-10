/*
 * buyHold.js — 买入持有基准策略
 * 首个交易日收盘买入，持有到回测结束（用于衡量策略是否创造超额收益）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StrategyBuyHold = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return {
    id: "buyHold",
    name: "买入持有",
    short: "持有",
    desc: "首个交易日收盘买入并持有到期末（基准线，用于判断策略是否创造超额收益）",
    params: [],
    create: function () {
      var done = false;
      return {
        onBar: function (ctx) {
          if (!done) { done = true; ctx.buy({ stop: null }); }
        }
      };
    }
  };
});