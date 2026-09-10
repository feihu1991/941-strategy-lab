/*
 * charts.js — ECharts 封装（K线 / 净值对比 / 水下回撤 / 收益对比）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Charts = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PALETTE = ["#2f54eb", "#e0434f", "#18a058", "#f0a020", "#8b5cf6", "#0ea5e9", "#64748b"];

  function getEcharts() {
    if (typeof echarts === "undefined") throw new Error("ECharts 未加载");
    return echarts;
  }

  function makeChart(el, opts) {
    var ec = getEcharts();
    var inst = ec.getInstanceByDom(el) || ec.init(el);
    inst.setOption(Object.assign({ backgroundColor: "transparent" }, opts), true);
    return inst;
  }

  function pctFormatter(v) { return (v * 100).toFixed(1) + "%"; }

  /** K线 + 买卖信号 */
  function candle(el, dates, bars, signals) {
    var data = bars.map(function (b) { return [b.open, b.close, b.low, b.high]; });
    var marks = (signals || []).map(function (s) {
      return {
        name: s.type,
        coord: [s.idx, s.price],
        value: s.type === "buy" ? "买" : "卖",
        symbolRotate: s.type === "buy" ? 0 : 180,
        itemStyle: { color: s.type === "buy" ? "#e0434f" : "#18a058" }
      };
    });
    return makeChart(el, {
      animation: false,
      grid: { left: 58, right: 16, top: 24, bottom: 52 },
      tooltip: { trigger: "axis", axisPointer: { type: "cross" },
        formatter: function (ps) {
          var p = ps[0];
          if (!p) return "";
          var b = bars[p.dataIndex];
          var sg = (signals || []).filter(function (x) { return x.idx === p.dataIndex; });
          return b.date + "<br/>开 " + b.open + " 收 " + b.close + "<br/>高 " + b.high + " 低 " + b.low +
            (sg.length ? "<br/><b>" + sg.map(function (x) { return (x.type === "buy" ? "买入 " : "卖出 ") + x.price.toFixed(2) + "（" + (x.reason || "") + "）"; }).join("<br/>") + "</b>" : "");
        } },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10, hideOverlap: true } },
      yAxis: { scale: true, splitLine: { lineStyle: { color: "#f0f1f3" } } },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 8 }],
      series: [{
        type: "candlestick", data: data,
        itemStyle: { color: "#e0434f", color0: "#18a058", borderColor: "#e0434f", borderColor0: "#18a058" },
        markPoint: { symbol: "pin", symbolSize: 34, label: { fontSize: 9 }, data: marks }
      }]
    });
  }

  /** 多曲线净值对比（策略 + 基准） */
  function equityCompare(el, dates, series) {
    return makeChart(el, {
      animation: false,
      legend: { top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
      grid: { left: 56, right: 16, top: 34, bottom: 46 },
      tooltip: { trigger: "axis", valueFormatter: function (v) { return (v * 100 - 100).toFixed(2) + "%"; } },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10, hideOverlap: true } },
      yAxis: { type: "value", scale: true, axisLabel: { formatter: pctFormatter }, splitLine: { lineStyle: { color: "#f0f1f3" } } },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 6 }],
      series: series.map(function (s, i) {
        return {
          name: s.name, type: "line", showSymbol: false, data: s.data,
          lineStyle: { width: s.width || 2, color: s.color || PALETTE[i % PALETTE.length], type: s.dash ? "dashed" : "solid" },
          itemStyle: { color: s.color || PALETTE[i % PALETTE.length] }
        };
      })
    });
  }

  /** 水下回撤曲线 */
  function underwater(el, dates, series) {
    return makeChart(el, {
      animation: false,
      legend: { top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
      grid: { left: 56, right: 16, top: 34, bottom: 40 },
      tooltip: { trigger: "axis", valueFormatter: function (v) { return (v * 100).toFixed(2) + "%"; } },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10, hideOverlap: true } },
      yAxis: { type: "value", max: 0, axisLabel: { formatter: pctFormatter }, splitLine: { lineStyle: { color: "#f0f1f3" } } },
      series: series.map(function (s, i) {
        return {
          name: s.name, type: "line", showSymbol: false, data: s.data, areaStyle: { opacity: 0.12 },
          lineStyle: { width: 1.5, color: s.color || PALETTE[i % PALETTE.length] },
          itemStyle: { color: s.color || PALETTE[i % PALETTE.length] }
        };
      })
    });
  }

  /** 横向对比柱状图（各股票收益 / 各策略收益） */
  function bars(el, labels, series, opts) {
    opts = opts || {};
    return makeChart(el, {
      animation: false,
      legend: series.length > 1 ? { top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } } : undefined,
      grid: { left: 56, right: 16, top: series.length > 1 ? 30 : 18, bottom: 42 },
      tooltip: { trigger: "axis", valueFormatter: function (v) { return (v * 100).toFixed(1) + "%"; } },
      xAxis: { type: "category", data: labels, axisLabel: { fontSize: 10, interval: 0, rotate: opts.rotate || 0 } },
      yAxis: { type: "value", axisLabel: { formatter: pctFormatter }, splitLine: { lineStyle: { color: "#f0f1f3" } } },
      series: series.map(function (s, i) {
        return {
          name: s.name, type: "bar", data: s.data, barMaxWidth: 26,
          itemStyle: { color: s.color || PALETTE[i % PALETTE.length], borderRadius: [3, 3, 0, 0] }
        };
      })
    });
  }

  return { candle: candle, equityCompare: equityCompare, underwater: underwater, bars: bars, PALETTE: PALETTE };
});