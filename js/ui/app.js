/*
 * app.js — 主控制器
 * 状态: 股票列表 / 启用策略 / 参数 / 周期 / 视图 / 组合勾选 / 详情目标
 * 数据流: DataSources.load(bars) -> 每启用策略 Engine 回测 -> 渲染(卡片/表格/组合/详情)
 */
(function () {
  "use strict";

  var DEFAULT_STOCKS = ["sh600519", "sh600036", "sz300750", "sz002594", "sh688981", "usAAPL"];
  var VIEW_KEY = "941.view";

  var state = {
    stocks: [],            // [{input, display, name, code, bars, results, loading, error}]
    enabled: ["priceAction", "dualMA", "donchian", "rsiReversal", "buyHold"],
    active: "priceAction",
    params: null,          // {strategyId: {key: value}}
    years: 3,
    view: "cards",
    sortKey: "totalReturn",
    sortDir: "desc",
    picked: {},
    detail: null
  };

  var charts = {};   // 详情/组合图表实例
  var $ = function (id) { return document.getElementById(id); };
  var C = window.Components, DS = window.DataSources, SR = window.StrategyRegistry;

  // ---------- 工具 ----------
  function toast(msg, isErr) {
    var t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.remove(); }, 2600);
  }

  function enabledStrategies() {
    return SR.all.filter(function (s) { return state.enabled.indexOf(s.id) >= 0; });
  }

  // ---------- 回测编排 ----------
  function runStrategy(stock, sid) {
    return SR.backtest(sid, stock.bars, state.params[sid]);
  }

  function recomputeStock(stock) {
    if (!stock.bars) return;
    stock.results = {};
    state.enabled.forEach(function (sid) {
      try {
        var r = runStrategy(stock, sid);
        if (r) stock.results[sid] = r;
      } catch (e) {
        // 单策略失败不影响其他策略
        if (window.console) console.warn("策略失败 " + sid + " @ " + stock.input, e);
      }
    });
  }

  function recomputeAll() {
    state.stocks.forEach(recomputeStock);
    render();
  }

  // ---------- 加载 ----------
  function addStock(input, silent) {
    var res = DS.resolveSymbol(input);
    if (!res) { toast("无法识别代码: " + input, true); return Promise.reject(new Error("bad symbol")); }
    var dup = state.stocks.some(function (s) {
      var r = DS.resolveSymbol(s.input);
      return r && r.em === res.em;
    });
    if (dup) { if (!silent) toast("该股票已在列表中"); return Promise.resolve(null); }

    var stock = { input: input, display: res.display, loading: true, results: null, bars: null, error: null };
    state.stocks.push(stock);
    render();

    return DS.load(input, state.years).then(function (d) {
      stock.name = d.name;
      stock.code = d.code;
      stock.display = d.display;
      stock.bars = d.bars;
      stock.source = d.source;
      stock.loading = false;
      recomputeStock(stock);
      render();
      if (!silent) toast("已加载 " + (stock.name || stock.display) + "（" + d.source + "，" + d.bars.length + " 根K线）");
      return stock;
    }).catch(function (e) {
      stock.loading = false;
      stock.error = e.message || String(e);
      render();
      if (!silent) toast("加载失败: " + stock.error, true);
      return null;
    });
  }

  function reloadAll() {
    state.stocks.forEach(function (s) {
      s.bars = null; s.results = null; s.error = null; s.loading = true;
    });
    render();
    var items = state.stocks.slice();
    state.stocks = [];
    DS.clearCache();
    items.forEach(function (s) { addStock(s.input, true); });
  }

  // ---------- 组合回测 ----------
  /** 按日期前向填充对齐多条净值曲线 */
  function alignCurves(list) {
    // list: [{dates, values}]，以日期并集为轴，前向填充
    var allDates = [];
    var seen = {};
    list.forEach(function (c) {
      c.dates.forEach(function (d) { if (!seen[d]) { seen[d] = 1; allDates.push(d); } });
    });
    allDates.sort();
    var aligned = list.map(function (c) {
      var map = {};
      c.dates.forEach(function (d, i) { map[d] = c.values[i]; });
      var out = [], last = null;
      allDates.forEach(function (d) {
        if (map[d] !== undefined) last = map[d];
        out.push(last === null ? 1.0 : last);
      });
      return out;
    });
    return { dates: allDates, series: aligned };
  }

  function portfolioData(sid) {
    var picked = state.stocks.filter(function (s) {
      return state.picked[s.input] && s.results && s.results[sid];
    });
    if (!picked.length) return null;
    var list = picked.map(function (s) {
      return { dates: s.results[sid].dates, values: s.results[sid].equity };
    });
    var aligned = alignCurves(list);
    var combined = [];
    for (var i = 0; i < aligned.dates.length; i++) {
      var sum = 0;
      for (var j = 0; j < aligned.series.length; j++) sum += aligned.series[j][i];
      combined.push(sum / aligned.series.length);
    }
    // 组合基准（等权买入持有）
    var benchList = picked.map(function (s) { return { dates: s.results[sid].dates, values: s.results[sid].bench }; });
    var ab = alignCurves(benchList);
    var bench = [];
    for (var k = 0; k < ab.dates.length; k++) {
      var s2 = 0;
      for (var m = 0; m < ab.series.length; m++) s2 += ab.series[m][k];
      bench.push(s2 / ab.series.length);
    }
    // 交易统计：汇总各股票
    var trades = [];
    picked.forEach(function (s) { trades = trades.concat(s.results[sid].trades); });
    var stats = window.Metrics.summarize(combined, trades, bench, { initial: 1.0 });
    return { dates: aligned.dates, equity: combined, bench: bench, stats: stats, count: picked.length, stocks: picked };
  }

  // ---------- 渲染 ----------
  function render() {
    renderControls();
    renderSummary();
    renderMain();
    renderPortfolio();
    renderDetail();
  }

  function renderControls() {
    $("strategyChips").innerHTML = C.strategyChips(SR.all, state.enabled, state.active);
    // 主策略下拉（chips 只负责启用/禁用，避免点击语义冲突）
    $("activeSelect").innerHTML = enabledStrategies().map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === state.active ? " selected" : "") + '>' + C.esc(s.name) + '</option>';
    }).join("");
    var activeStrategy = SR.get(state.active);
    $("paramTitle").textContent = activeStrategy ? activeStrategy.name + " · 参数" : "参数";
    $("paramPanel").innerHTML = C.paramPanel(activeStrategy, state.params[state.active] || {}, null);
    $("strategyDesc").textContent = activeStrategy ? activeStrategy.desc : "";
    $("viewCards").classList.toggle("on", state.view === "cards");
    $("viewTable").classList.toggle("on", state.view === "table");
  }

  function renderSummary() {
    var labels = [], series = [[], []];
    state.stocks.forEach(function (s) {
      var r = s.results && s.results[state.active];
      labels.push(s.name || s.display || s.input);
      series[0].push(r ? r.stats.totalReturn : 0);
      series[1].push(r ? r.stats.benchTotal : 0);
    });
    var el = $("summaryChart");
    if (!labels.length) { el.innerHTML = '<p class="muted">暂无数据</p>'; return; }
    charts.summary = window.Charts.bars(el, labels, [
      { name: SR.get(state.active).name, data: series[0], color: "#2f54eb" },
      { name: "买入持有", data: series[1], color: "#94a3b8" }
    ], { rotate: labels.length > 6 ? 18 : 0 });
  }

  function renderMain() {
    if (state.view === "cards") {
      $("cards").classList.remove("hidden");
      $("tableWrap").classList.add("hidden");
      $("cards").innerHTML = state.stocks.map(function (s) {
        return '<div class="card" data-input="' + C.esc(s.input) + '">' +
          C.stockCard(s, state.enabled, state.active, !!state.picked[s.input]) + '</div>';
      }).join("");
    } else {
      $("cards").classList.add("hidden");
      $("tableWrap").classList.remove("hidden");
      $("tableWrap").innerHTML = C.resultTable(state.stocks, state.enabled, state.active, state.sortKey, state.sortDir);
    }
  }

  function renderPortfolio() {
    var box = $("portfolioBox");
    var pickedCount = Object.keys(state.picked).filter(function (k) { return state.picked[k]; }).length;
    if (!pickedCount) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    var main = portfolioData(state.active);
    if (!main) { box.classList.add("hidden"); return; }
    $("portfolioMeta").textContent = main.count + " 只股票等权组合 · 主策略 " + SR.get(state.active).name;

    var series = enabledStrategies().map(function (s) {
      var pf = portfolioData(s.id);
      return pf ? { name: s.name, data: pf.equity } : null;
    }).filter(Boolean);
    series.push({ name: "等权买入持有", data: main.bench, color: "#94a3b8", dash: true, width: 1.5 });
    charts.portfolio = window.Charts.equityCompare($("portfolioChart"), main.dates, series);

    // 组合指标 + 各策略组合对比表
    var rows = enabledStrategies().map(function (s) {
      var pf = portfolioData(s.id);
      if (!pf) return "";
      var st = pf.stats;
      return '<tr><td>' + C.esc(s.name) + '</td>' +
        '<td class="' + C.cls(st.totalReturn) + '">' + C.pct(st.totalReturn) + '</td>' +
        '<td class="' + C.cls(st.excessReturn) + '">' + C.pct(st.excessReturn) + '</td>' +
        '<td class="down">' + C.pct(st.maxDrawdown) + '</td>' +
        '<td>' + C.num(st.sharpe) + '</td>' +
        '<td>' + C.num(st.calmar) + '</td>' +
        '<td>' + st.tradeCount + '</td></tr>';
    }).join("");
    $("portfolioStats").innerHTML =
      '<div class="scroll-hint">← 左右滑动查看全部指标 →</div>' +
      '<div class="table-scroll"><table class="result-table"><thead><tr>' +
      '<th>策略</th><th>组合收益</th><th>超额</th><th>最大回撤</th><th>夏普</th><th>Calmar</th><th>总交易</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderDetail() {
    var stock = state.stocks.filter(function (s) { return s.input === state.detail; })[0];
    var box = $("detail");
    if (!stock || !stock.results || !stock.results[state.active]) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    var r = stock.results[state.active];
    $("detailTitle").textContent = (stock.name || stock.display) + " · " + (stock.code || "") +
      " · " + SR.get(state.active).name + " · " + state.years + "年 · 数据源 " + (stock.source || "—");
    $("detailStats").innerHTML = C.statsTable(r.stats);
    $("detailTrades").innerHTML = C.tradeTable(r.trades);

    // 图表在下一帧渲染: 确保容器已布局(宽度非 0), 否则 ECharts 会按 0 宽初始化
    var renderCharts = function () {
      // 多策略净值对比
      var series = enabledStrategies().map(function (s) {
        var rr = stock.results[s.id];
        return rr ? { name: s.name, data: rr.equity } : null;
      }).filter(Boolean);
      series.push({ name: "买入持有", data: r.bench, color: "#94a3b8", dash: true, width: 1.5 });
      charts.detailEquity = window.Charts.equityCompare($("detailEquity"), r.dates, series);

      // 水下回撤
      var ddSeries = enabledStrategies().map(function (s) {
        var rr = stock.results[s.id];
        if (!rr) return null;
        return { name: s.name, data: window.Indicators.drawdown(rr.equity) };
      }).filter(Boolean);
      charts.detailDD = window.Charts.underwater($("detailDD"), r.dates, ddSeries);

      // K线 + 当前策略信号
      charts.detailCandle = window.Charts.candle($("detailCandle"), r.dates, stock.bars, r.signals);

      // 修正可能的 0 宽初始化
      Object.keys(charts).forEach(function (k) { if (charts[k] && charts[k].resize) charts[k].resize(); });
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(renderCharts);
    else renderCharts();
  }

  // ---------- 事件 ----------
  function bind() {
    $("addBtn").addEventListener("click", function () {
      var v = $("symbolInput").value.trim();
      if (v) { addStock(v); $("symbolInput").value = ""; }
    });
    $("symbolInput").addEventListener("keydown", function (e) { if (e.key === "Enter") $("addBtn").click(); });

    $("years").addEventListener("change", function () {
      state.years = parseInt($("years").value, 10);
      state.detail = null;
      reloadAll();
    });

    $("viewCards").addEventListener("click", function () { state.view = "cards"; render(); });
    $("viewTable").addEventListener("click", function () { state.view = "table"; render(); });

    // 策略启用开关（chips 仅控制启用/禁用）
    $("strategyChips").addEventListener("change", function (e) {
      var sid = e.target.getAttribute("data-strategy");
      if (!sid) return;
      var idx = state.enabled.indexOf(sid);
      if (e.target.checked && idx < 0) state.enabled.push(sid);
      if (!e.target.checked && idx >= 0) state.enabled.splice(idx, 1);
      if (!state.enabled.length) { state.enabled.push(sid); toast("至少保留一个策略"); }
      if (state.enabled.indexOf(state.active) < 0) state.active = state.enabled[0];
      recomputeAll();
    });

    // 主策略切换
    $("activeSelect").addEventListener("change", function () {
      state.active = $("activeSelect").value;
      render();
    });

    // 参数滑块
    $("paramPanel").addEventListener("input", function (e) {
      var key = e.target.getAttribute("data-param");
      if (!key) return;
      var v = parseFloat(e.target.value);
      state.params[state.active][key] = v;
      var label = $("paramPanel").querySelector('[data-val="' + key + '"]');
      if (label) label.textContent = v;
    });
    $("paramPanel").addEventListener("change", function () { recomputeAll(); });
    $("paramPanel").addEventListener("click", function (e) {
      if (e.target.getAttribute && e.target.getAttribute("data-role") === "reset-params") {
        state.params[state.active] = SR.defaultParams(state.active);
        recomputeAll();
      }
    });

    // 主区域：卡片点击（详情）/ 勾选（组合）/ 表格排序
    $("cards").addEventListener("click", function (e) {
      var card = e.target.closest ? e.target.closest(".card") : null;
      if (!card) return;
      var input = card.getAttribute("data-input");
      if (e.target.getAttribute && e.target.getAttribute("data-role") === "pick") {
        state.picked[input] = e.target.checked;
        renderPortfolio();
        return;
      }
      state.detail = input;
      render();
      var el = $("detail");
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth" });
    });

    $("tableWrap").addEventListener("click", function (e) {
      var th = e.target.closest ? e.target.closest("th[data-sort]") : null;
      if (!th) return;
      var key = th.getAttribute("data-sort");
      if (state.sortKey === key) state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
      else { state.sortKey = key; state.sortDir = "desc"; }
      renderMain();
    });

    $("closeDetail").addEventListener("click", function () { state.detail = null; renderDetail(); });

    window.addEventListener("resize", function () {
      Object.keys(charts).forEach(function (k) { if (charts[k] && charts[k].resize) charts[k].resize(); });
    });
  }

  function init() {
    state.params = SR.allDefaultParams();
    bind();
    DEFAULT_STOCKS.forEach(function (s, idx) {
      addStock(s, true);
      if (idx < 3) state.picked[s] = true;  // 默认勾选前 3 只做组合
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();