/*
 * components.js — DOM 渲染组件（卡片 / 表格 / 参数面板 / 指标表 / 交易明细）
 * 所有接口数据均经过 esc() 转义，避免 XSS
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Components = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pct(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    return (v * 100).toFixed(digits === undefined ? 1 : digits) + "%";
  }
  function num(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return "∞";
    return v.toFixed(digits === undefined ? 2 : digits);
  }
  function cls(v) { return v >= 0 ? "up" : "down"; }

  function sparkline(values, w, h, color) {
    var n = values.length;
    if (!n) return "";
    var step = Math.max(1, Math.floor(n / 60));
    var min = Infinity, max = -Infinity, i;
    for (i = 0; i < n; i += step) { if (values[i] < min) min = values[i]; if (values[i] > max) max = values[i]; }
    if (min === max) { min -= 0.01; max += 0.01; }
    var pts = [];
    for (i = 0; i < n; i += step) {
      pts.push(((i / (n - 1)) * w).toFixed(1) + "," + (h - ((values[i] - min) / (max - min)) * h).toFixed(1));
    }
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<polyline fill="none" stroke="' + color + '" stroke-width="1.5" points="' + pts.join(" ") + '"/></svg>';
  }

  /**
   * 股票卡片
   * @param item      { input, display, name, code, bars, results: {strategyId: result}, loading, error }
   * @param strategyIds 启用的策略 id 列表
   * @param activeId  主策略 id
   * @param selected  是否加入组合
   */
  function stockCard(item, strategyIds, activeId, selected) {
    var head = '<div class="card-head">' +
      '<label class="pick"><input type="checkbox" data-role="pick"' + (selected ? " checked" : "") + '></label>' +
      '<span class="card-name">' + esc(item.name || item.display || item.input) + '</span>' +
      '<span class="card-code">' + esc(item.code || item.display) + '</span>' +
      '</div>';

    if (item.error) return head + '<div class="card-err">⚠️ ' + esc(item.error) + '</div>';
    if (item.loading) return head + '<div class="card-loading">加载中</div>';
    if (!item.results || !item.results[activeId]) return head + '<div class="card-err">数据不足，无法回测</div>';

    var main = item.results[activeId].stats;
    var color = main.totalReturn >= 0 ? "#e0434f" : "#18a058";
    var badges = strategyIds.map(function (sid) {
      var r = item.results[sid];
      if (!r) return "";
      var st = r.stats;
      return '<span class="badge' + (sid === activeId ? " active" : "") + '">' +
        esc(r.strategyName.replace(/^941 /, "")) + ' <b class="' + cls(st.totalReturn) + '">' + pct(st.totalReturn, 1) + '</b></span>';
    }).join("");

    return head +
      '<div class="card-ret ' + cls(main.totalReturn) + '">' + pct(main.totalReturn, 1) + '</div>' +
      '<div class="card-sub">' + esc(item.results[activeId].strategyName) +
      ' · 超额 <span class="' + cls(main.excessReturn) + '">' + pct(main.excessReturn, 1) + '</span></div>' +
      '<div class="card-row">' +
      '<span>回撤 <b class="down">' + pct(main.maxDrawdown, 1) + '</b></span>' +
      '<span>夏普 <b>' + num(main.sharpe) + '</b></span>' +
      '<span>胜率 <b>' + (main.winRate * 100).toFixed(0) + '%</b></span>' +
      '<span>交易 <b>' + main.tradeCount + '</b></span>' +
      '</div>' +
      '<div class="card-badges">' + badges + '</div>' +
      '<div class="card-spark">' + sparkline(item.results[activeId].equity, 260, 40, color) + '</div>';
  }

  /** 多策略结果表（可排序） */
  function resultTable(items, strategyIds, activeId, sortKey, sortDir) {
    var cols = [
      { key: "name", label: "股票", sortable: false },
      { key: "totalReturn", label: "策略收益", sortable: true },
      { key: "benchTotal", label: "买入持有", sortable: true },
      { key: "excessReturn", label: "超额", sortable: true },
      { key: "maxDrawdown", label: "最大回撤", sortable: true },
      { key: "sharpe", label: "夏普", sortable: true },
      { key: "calmar", label: "Calmar", sortable: true },
      { key: "winRate", label: "胜率", sortable: true },
      { key: "tradeCount", label: "交易数", sortable: true },
      { key: "exposure", label: "持仓占比", sortable: true }
    ];
    var rows = items.map(function (it) {
      var r = it.results && it.results[activeId];
      return { item: it, stats: r ? r.stats : null };
    });
    if (sortKey) {
      rows.sort(function (a, b) {
        var va = a.stats ? Metrics.sortable(a.stats[sortKey]) : -Number.MAX_VALUE;
        var vb = b.stats ? Metrics.sortable(b.stats[sortKey]) : -Number.MAX_VALUE;
        return sortDir === "asc" ? va - vb : vb - va;
      });
    }
    var head = cols.map(function (c) {
      var arrow = sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : "";
      return '<th' + (c.sortable ? ' class="sortable" data-sort="' + c.key + '"' : '') + '>' + c.label + arrow + '</th>';
    }).join("");
    var body = rows.map(function (row) {
      var it = row.item, s = row.stats;
      if (!s) {
        return '<tr><td>' + esc(it.name || it.display) + '</td><td colspan="9" class="muted">' +
          esc(it.error || "加载中/无数据") + '</td></tr>';
      }
      return '<tr>' +
        '<td class="strong">' + esc(it.name || it.display) + ' <span class="muted">' + esc(it.code || "") + '</span></td>' +
        '<td class="' + cls(s.totalReturn) + '">' + pct(s.totalReturn) + '</td>' +
        '<td class="' + cls(s.benchTotal) + '">' + pct(s.benchTotal) + '</td>' +
        '<td class="' + cls(s.excessReturn) + '">' + pct(s.excessReturn) + '</td>' +
        '<td class="down">' + pct(s.maxDrawdown) + '</td>' +
        '<td>' + num(s.sharpe) + '</td>' +
        '<td>' + num(s.calmar) + '</td>' +
        '<td>' + (s.winRate * 100).toFixed(0) + '%</td>' +
        '<td>' + s.tradeCount + '</td>' +
        '<td>' + (s.exposure * 100).toFixed(0) + '%</td>' +
        '</tr>';
    }).join("");
    return '<table class="result-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  /** 策略参数面板 */
  function paramPanel(strategy, params, onChange) {
    if (!strategy || !strategy.params.length) return '<p class="muted">该策略无可调参数。</p>';
    return strategy.params.map(function (p) {
      var v = params[p.key];
      return '<div class="param">' +
        '<label>' + esc(p.label) + '</label>' +
        '<input type="range" min="' + p.min + '" max="' + p.max + '" step="' + p.step + '" value="' + v + '" data-param="' + esc(p.key) + '">' +
        '<span class="param-val" data-val="' + esc(p.key) + '">' + v + '</span>' +
        '</div>';
    }).join("") + '<div class="param-actions"><button class="btn ghost" data-role="reset-params">恢复默认</button></div>';
  }

  /** 指标表（详情用） */
  function statsTable(stats) {
    var rows = [
      ["策略收益", pct(stats.totalReturn), cls(stats.totalReturn)],
      ["年化收益", pct(stats.annualReturn), cls(stats.annualReturn)],
      ["超额收益", pct(stats.excessReturn), cls(stats.excessReturn)],
      ["买入持有", pct(stats.benchTotal), cls(stats.benchTotal)],
      ["最大回撤", pct(stats.maxDrawdown), "down"],
      ["回撤持续", stats.maxDrawdownDays + " 天", ""],
      ["年化波动", pct(stats.volatility), ""],
      ["夏普比率", num(stats.sharpe), ""],
      ["Calmar", num(stats.calmar), ""],
      ["胜率", (stats.winRate * 100).toFixed(0) + "%", ""],
      ["盈亏比", isFinite(stats.payoffRatio) ? num(stats.payoffRatio) : "∞", ""],
      ["盈利因子", isFinite(stats.profitFactor) ? num(stats.profitFactor) : "∞", ""],
      ["交易次数", stats.tradeCount + " 次", ""],
      ["平均持仓", stats.avgHoldBars + " 天", ""],
      ["持仓占比", (stats.exposure * 100).toFixed(0) + "%", ""]
    ];
    return '<table class="stats-table"><tbody>' + rows.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td class="' + r[2] + '">' + r[1] + '</td></tr>';
    }).join("") + '</tbody></table>';
  }

  /** 交易明细 */
  function tradeTable(trades) {
    if (!trades.length) return '<p class="muted">无交易记录。</p>';
    var rows = trades.slice().reverse().map(function (t) {
      return '<tr>' +
        '<td>' + esc(t.entryDate) + '</td><td>' + esc(t.exitDate) + '</td>' +
        '<td>' + t.entryPrice.toFixed(2) + '</td><td>' + t.exitPrice.toFixed(2) + '</td>' +
        '<td class="' + cls(t.ret) + '">' + pct(t.ret) + '</td>' +
        '<td>' + t.bars + '天</td><td class="muted">' + esc(t.reason) + '</td>' +
        '</tr>';
    }).join("");
    return '<div class="scroll-y"><table class="trade-table"><thead><tr>' +
      '<th>入场</th><th>出场</th><th>入场价</th><th>出场价</th><th>收益</th><th>持仓</th><th>原因</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /** 策略多选 chips */
  function strategyChips(strategies, enabled, activeId) {
    return strategies.map(function (s) {
      var on = enabled.indexOf(s.id) >= 0;
      return '<label class="chip' + (on ? " on" : "") + (s.id === activeId ? " active" : "") + '">' +
        '<input type="checkbox" data-strategy="' + s.id + '"' + (on ? " checked" : "") + '>' +
        '<span>' + esc(s.name) + '</span></label>';
    }).join("");
  }

  return {
    esc: esc, pct: pct, num: num, cls: cls, sparkline: sparkline,
    stockCard: stockCard, resultTable: resultTable, paramPanel: paramPanel,
    statsTable: statsTable, tradeTable: tradeTable, strategyChips: strategyChips
  };
});