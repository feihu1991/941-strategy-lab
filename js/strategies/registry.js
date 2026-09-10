/*
 * registry.js — 策略注册表
 * 统一暴露策略列表、默认参数、以及"按参数回测"的便捷入口
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./priceAction.js"), require("./dualMA.js"), require("./donchian.js"),
      require("./rsiReversal.js"), require("./buyHold.js"), require("../core/engine.js")
    );
  } else {
    root.StrategyRegistry = factory(
      root.StrategyPriceAction, root.StrategyDualMA, root.StrategyDonchian,
      root.StrategyRsiReversal, root.StrategyBuyHold, root.Engine
    );
  }
})(typeof self !== "undefined" ? self : this, function (priceAction, dualMA, donchian, rsiReversal, buyHold, Engine) {
  "use strict";

  var ALL = [priceAction, dualMA, donchian, rsiReversal, buyHold];

  var index = {};
  ALL.forEach(function (s) { index[s.id] = s; });

  /** 默认参数对象 */
  function defaultParams(id) {
    var s = index[id];
    var out = {};
    if (s) s.params.forEach(function (p) { out[p.key] = p.def; });
    return out;
  }

  /** 所有策略的默认参数 */
  function allDefaultParams() {
    var out = {};
    ALL.forEach(function (s) { out[s.id] = defaultParams(s.id); });
    return out;
  }

  /** 用指定参数对 bars 回测 */
  function backtest(strategyId, bars, params, options) {
    var s = index[strategyId];
    if (!s) throw new Error("未知策略: " + strategyId);
    var p = Object.assign({}, defaultParams(strategyId), params || {});
    return Engine.run(bars, s, p, options);
  }

  /** 多策略批量回测 */
  function backtestMany(strategyIds, bars, paramsMap, options) {
    var out = {};
    strategyIds.forEach(function (id) {
      out[id] = backtest(id, bars, (paramsMap || {})[id], options);
    });
    return out;
  }

  return {
    all: ALL,
    get: function (id) { return index[id]; },
    defaultParams: defaultParams,
    allDefaultParams: allDefaultParams,
    backtest: backtest,
    backtestMany: backtestMany
  };
});