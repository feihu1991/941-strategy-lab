/*
 * app.js — 941 策略研究台 UI 逻辑
 * 依赖: Strategy941 (strategy.js), Data941 (data.js), ECharts
 */
(function () {
  "use strict";

  // ---------- 默认展示股票 ----------
  var DEFAULT_SYMBOLS = [
    { input: "sh600519", label: "贵州茅台" },
    { input: "sh600036", label: "招商银行" },
    { input: "sz300750", label: "宁德时代" },
    { input: "sz002594", label: "比亚迪" },
    { input: "usAAPL", label: "苹果" },
    { input: "usTSLA", label: "特斯拉" }
  ];

  // ---------- 策略参数档位 ----------
  var MODES = {
    default: { name: "标准", opts: { smaFast: 50, smaSlow: 200, stopAtr: 2.5, takeProfitR: 3 } },
    stable: { name: "稳健", opts: { smaFast: 60, smaSlow: 250, stopAtr: 3.0, takeProfitR: 2.5 } },
    aggressive: { name: "激进", opts: { smaFast: 30, smaSlow: 150, stopAtr: 2.0, takeProfitR: 4 } }
  };

  var state = {
    items: [],      // { input, label, data:{name,rows}, result }
    mode: "default",
    years: 3
  };

  var $ = function (id) { return document.getElementById(id); };

  // ---------- 工具 ----------
  function fmtPct(v) {
    return (v * 100).toFixed(1) + "%";
  }
  function cls(v) {
    return v >= 0 ? "up" : "down";
  }
  function toast(msg, isErr) {
    var t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 10);
    setTimeout(function () { t.remove(); }, 2600);
  }

  // ---------- 数据加载 + 回测 ----------
  function loadOne(item) {
    item.loading = true;
    item.error = null;
    renderCard(item);
    return Data941.loadSymbol(item.input, state.years).then(function (d) {
      item.data = d;
      item.label = d.name || item.label;
      item.loading = false;
      run(item);
      return item;
    }).catch(function (e) {
      item.loading = false;
      item.error = e.message || String(e);
      renderCard(item);
      throw e;
    });
  }

  function run(item) {
    if (!item.data) return;
    var opts = MODES[state.mode].opts;
    item.result = Strategy941.backtest(item.data.rows, opts);
    renderCard(item);
  }

  // ---------- 卡片渲染 ----------
  function sparklineSvg(values, w, h, color) {
    var n = values.length;
    var step = Math.max(1, Math.floor(n / 52));
    var pts = [];
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < n; i += step) {
      var v = values[i].value;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === max) { min -= 0.01; max += 0.01; }
    var x = 0, y = 0;
    for (var j = 0; j < n; j += step) {
      x = (j / (n - 1)) * w;
      y = h - ((values[j].value - min) / (max - min)) * h;
      pts.push(x.toFixed(1) + "," + y.toFixed(1));
    }
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<polyline fill="none" stroke="' + color + '" stroke-width="1.5" points="' + pts.join(" ") + '"/></svg>';
  }

  function renderCard(item) {
    var grid = $("cards");
    var card = document.createElement("div");
    card.className = "card";
    if (item.error) {
      card.innerHTML = '<div class="card-head"><span class="card-name">' + esc(item.label || item.input) + '</span></div>' +
        '<div class="card-err">⚠️ ' + esc(item.error) + '</div>';
    } else if (item.loading) {
      card.innerHTML = '<div class="card-head"><span class="card-name">' + esc(item.label || item.input) + '</span></div>' +
        '<div class="card-loading">加载中…</div>';
    } else if (!item.result) {
      card.innerHTML = '<div class="card-head"><span class="card-name">' + esc(item.label || item.input) + '</span></div>' +
        '<div class="card-err">数据不足, 无法回测</div>';
    } else {
      var s = item.result.stats;
      var tc = item.result.trades;
      var color = s.totalReturn >= 0 ? "#e0434f" : "#18a058";
      card.innerHTML =
        '<div class="card-head">' +
        '  <span class="card-name">' + esc(item.label || item.input) + '</span>' +
        '  <span class="card-code">' + esc(item.data.code) + '</span>' +
        '</div>' +
        '<div class="card-ret ' + cls(s.totalReturn) + '">' + fmtPct(s.totalReturn) + '</div>' +
        '<div class="card-sub">策略 vs 持有 <span class="' + cls(s.benchTotal) + '">' + fmtPct(s.benchTotal) + '</span></div>' +
        '<div class="card-row">' +
        '  <span>回撤 <b class="' + cls(-s.maxDrawdown) + '">' + fmtPct(s.maxDrawdown) + '</b></span>' +
        '  <span>胜率 <b>' + (s.winRate * 100).toFixed(0) + '%</b></span>' +
        '  <span>交易 <b>' + s.tradeCount + ' 次</b></span>' +
        '</div>' +
        '<div class="card-spark">' + sparklineSvg(item.result.equity, 220, 44, color) + '</div>';
      card.addEventListener("click", function () { showDetail(item); });
    }
    card.dataset.key = item.input;
    grid.appendChild(card);
  }

  function refreshGrid() {
    $("cards").innerHTML = "";
    state.items.forEach(function (it) { renderCard(it); });
  }

  // ---------- 详情视图 ----------
  var klineChart = null, eqChart = null;

  function showDetail(item) {
    if (!item.result) return;
    $("detail").classList.remove("hidden");
    $("detailTitle").textContent = (item.label || item.input) + " · " + item.data.code + "  ·  " + state.years + "年 / " + MODES[state.mode].name;
    $("detail").scrollIntoView({ behavior: "smooth" });

    var r = item.result;
    var dates = r.bars.map(function (b) { return b.date; });
    var kdata = r.bars.map(function (b) { return [b.open, b.close, b.low, b.high]; });

    // 买卖点
    var marks = r.signals.map(function (sig) {
      return {
        name: sig.type,
        coord: [sig.date, sig.price],
        value: sig.type === "buy" ? "▲买" : "▼卖",
        itemStyle: { color: sig.type === "buy" ? "#e0434f" : "#18a058" }
      };
    });

    if (klineChart) klineChart.dispose();
    if (eqChart) eqChart.dispose();
    klineChart = echarts.init($("klineChart"));
    eqChart = echarts.init($("eqChart"));

    klineChart.setOption({
      backgroundColor: "#fff",
      grid: { left: 60, right: 20, top: 30, bottom: 40 },
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10 } },
      yAxis: { scale: true },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 6 }],
      series: [{
        type: "candlestick", data: kdata,
        itemStyle: { color: "#e0434f", color0: "#18a058", borderColor: "#e0434f", borderColor0: "#18a058" },
        markPoint: {
          symbol: "pin", symbolSize: 42, label: { fontSize: 9 },
          data: marks
        }
      }]
    });

    eqChart.setOption({
      backgroundColor: "#fff",
      legend: { data: ["941策略", "买入持有"], top: 4 },
      grid: { left: 55, right: 20, top: 36, bottom: 40 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", scale: true, axisLabel: { formatter: function (v) { return (v * 100).toFixed(0) + "%"; } } },
      series: [
        { name: "941策略", type: "line", showSymbol: false, data: r.equity.map(function (p) { return p.value; }), lineStyle: { width: 2, color: "#2f54eb" }, itemStyle: { color: "#2f54eb" } },
        { name: "买入持有", type: "line", showSymbol: false, data: r.bench.map(function (p) { return p.value; }), lineStyle: { width: 1.5, color: "#999", type: "dashed" }, itemStyle: { color: "#999" } }
      ]
    });

    // 指标表
    var s = r.stats;
    var rows = [
      ["策略总收益", fmtPct(s.totalReturn), cls(s.totalReturn)],
      ["年化收益", fmtPct(s.annualReturn), cls(s.annualReturn)],
      ["最大回撤", fmtPct(s.maxDrawdown), "down"],
      ["胜率", (s.winRate * 100).toFixed(0) + "%", ""],
      ["盈亏比", s.profitFactor.toFixed(2), ""],
      ["交易次数", s.tradeCount + " 次", ""],
      ["平均持仓", s.avgHoldBars + " 天", ""],
      ["买入持有收益", fmtPct(s.benchTotal), cls(s.benchTotal)],
      ["基准最大回撤", fmtPct(s.benchDD), "down"]
    ];
    $("statsTable").innerHTML = '<table><tbody>' + rows.map(function (rowArr) {
      return '<tr><td>' + rowArr[0] + '</td><td class="' + rowArr[2] + '">' + rowArr[1] + '</td></tr>';
    }).join("") + '</tbody></table>';

    // 交易列表
    $("tradeList").innerHTML = '<h3>交易明细 (' + r.trades.length + ' 笔)</h3>' +
      '<table><thead><tr><td>入场</td><td>出场</td><td>入场价</td><td>出场价</td><td>收益</td><td>持仓</td><td>原因</td></tr></thead><tbody>' +
      r.trades.slice().reverse().map(function (t) {
        return '<tr><td>' + t.entryDate + '</td><td>' + t.exitDate + '</td><td>' + t.entryPrice.toFixed(2) +
          '</td><td>' + t.exitPrice.toFixed(2) + '</td><td class="' + cls(t.ret) + '">' + fmtPct(t.ret) +
          '</td><td>' + t.bars + '天</td><td>' + t.reason + '</td></tr>';
      }).join("") + '</tbody></table>';
  }

  function hideDetail() { $("detail").classList.add("hidden"); }

  // ---------- 添加股票 ----------
  function addSymbol(input) {
    var resolved = Data941.resolveSymbol(input);
    if (!resolved) { toast("无法识别代码: " + input, true); return; }
    if (state.items.some(function (it) { return Data941.resolveSymbol(it.input).secid === resolved.secid; })) {
      toast("该股票已在列表中");
      return;
    }
    var item = { input: input, label: input.toUpperCase() };
    state.items.push(item);
    renderCard(item);
    loadOne(item).then(function () {
      toast("已加载 " + (item.label || item.input));
    }, function (e) {
      toast("加载失败: " + (e.message || e), true);
    });
  }

  function init() {
    // 控件
    $("addBtn").addEventListener("click", function () {
      var v = $("symbolInput").value.trim();
      if (v) addSymbol(v);
    });
    $("symbolInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("addBtn").click();
    });
    $("mode").addEventListener("change", function () {
      state.mode = $("mode").value;
      state.items.forEach(run);
      toast("参数档位: " + MODES[state.mode].name);
    });
    $("years").addEventListener("change", function () {
      state.years = parseInt($("years").value, 10);
      state.items.forEach(function (it) { it.data = null; it.result = null; it.error = null; });
      refreshGrid();
      state.items.forEach(function (it) { loadOne(it); });
    });
    $("closeDetail").addEventListener("click", hideDetail);

    // 初始股票
    DEFAULT_SYMBOLS.forEach(function (d) {
      var item = { input: d.input, label: d.label };
      state.items.push(item);
      renderCard(item);
      loadOne(item).catch(function () { });
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();