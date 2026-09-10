/*
 * symbols.js — 股票字典与联想搜索
 *   1) 本地字典：热门标的（含拼音首字母），输入即时匹配，零延迟
 *   2) 在线搜索：东方财富搜索建议接口（JSONP，覆盖 A股/港股/美股/ETF 全市场）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Symbols = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SUGGEST_API = "https://searchapi.eastmoney.com/api/suggest/get";
  var TOKEN = "D43BF722C8E33BDC906FB84D85E326E8"; // 东财网页端公开 token

  // ---------- 本地热门字典 ----------
  // [代码, 名称, 拼音首字母, 市场]  市场: A=沪深, HK=港股, US=美股
  var RAW = [
    // A股 · 白酒食品
    ["600519", "贵州茅台", "gzmt", "A"], ["000858", "五粮液", "wly", "A"],
    ["600887", "伊利股份", "ylgf", "A"], ["603288", "海天味业", "htwy", "A"],
    ["000568", "泸州老窖", "lzlj", "A"], ["600809", "山西汾酒", "sxfj", "A"],
    // A股 · 金融
    ["600036", "招商银行", "zsyh", "A"], ["601318", "中国平安", "zgpa", "A"],
    ["600030", "中信证券", "zxzq", "A"], ["601166", "兴业银行", "xyyh", "A"],
    ["601398", "工商银行", "gsyh", "A"], ["601288", "农业银行", "nyyh", "A"],
    ["600000", "浦发银行", "pfyh", "A"], ["601601", "中国太保", "zgtb", "A"],
    ["300059", "东方财富", "dongfcf", "A"],
    // A股 · 新能源与制造
    ["300750", "宁德时代", "ndsd", "A"], ["002594", "比亚迪", "byd", "A"],
    ["601012", "隆基绿能", "ljln", "A"], ["002460", "赣锋锂业", "gfly", "A"],
    ["300274", "阳光电源", "ygdy", "A"], ["601127", "赛力斯", "sls", "A"],
    ["000333", "美的集团", "mdjt", "A"], ["000651", "格力电器", "gldq", "A"],
    ["300124", "汇川技术", "hcjs", "A"], ["601100", "恒立液压", "hlyy", "A"],
    // A股 · 半导体科技
    ["688981", "中芯国际", "zxgj", "A"], ["002415", "海康威视", "hkws", "A"],
    ["002230", "科大讯飞", "kdxf", "A"], ["688111", "金山办公", "jsbg", "A"],
    ["603501", "韦尔股份", "wegf", "A"], ["688008", "澜起科技", "lqkj", "A"],
    ["002371", "北方华创", "bfhc", "A"], ["300496", "中科创达", "zkcd", "A"],
    // A股 · 医药
    ["600276", "恒瑞医药", "hryy", "A"], ["300760", "迈瑞医疗", "mryl", "A"],
    ["603259", "药明康德", "ymkd", "A"], ["300347", "泰格医药", "tgyy", "A"],
    // A股 · 资源能源与基建
    ["601899", "紫金矿业", "zjky", "A"], ["600900", "长江电力", "cjdl", "A"],
    ["600028", "中国石化", "zgsh", "A"], ["601857", "中国石油", "zgsy", "A"],
    ["601668", "中国建筑", "zgjz", "A"], ["600585", "海螺水泥", "hlsn", "A"],
    ["601088", "中国神华", "zgsh", "A"], ["600309", "万华化学", "whhx", "A"],
    // A股 · 消费与其他
    ["601888", "中国中免", "zgzm", "A"], ["002714", "牧原股份", "mygf", "A"],
    ["000002", "万科A", "wka", "A"], ["601633", "长城汽车", "ccqc", "A"],
    ["600104", "上汽集团", "sqjt", "A"],
    // 港股
    ["00700", "腾讯控股", "txkg", "HK"], ["09988", "阿里巴巴", "albb", "HK"],
    ["03690", "美团", "mt", "HK"], ["01810", "小米集团", "xmjt", "HK"],
    ["09618", "京东集团", "jdjt", "HK"], ["02318", "中国平安H", "zgpaH", "HK"],
    ["00939", "建设银行H", "jsyhH", "HK"], ["01299", "友邦保险", "ybx", "HK"],
    ["00005", "汇丰控股", "hfkg", "HK"], ["09888", "百度集团", "bdjt", "HK"],
    ["02020", "安踏体育", "att", "HK"], ["09999", "网易", "wy", "HK"],
    // 美股
    ["AAPL", "苹果", "pg", "US"], ["TSLA", "特斯拉", "tsl", "US"],
    ["NVDA", "英伟达", "ywd", "US"], ["MSFT", "微软", "wr", "US"],
    ["GOOGL", "谷歌", "gg", "US"], ["AMZN", "亚马逊", "ymx", "US"],
    ["META", "Meta", "meta", "US"], ["NFLX", "奈飞", "nf", "US"],
    ["AMD", "AMD", "amd", "US"], ["INTC", "英特尔", "yter", "US"],
    ["BABA", "阿里巴巴(BABA)", "baba", "US"], ["JD", "京东", "jd", "US"],
    ["PDD", "拼多多", "pdd", "US"], ["NIO", "蔚来", "wl", "US"],
    ["COIN", "Coinbase", "coin", "US"], ["BRKB", "伯克希尔B", "bkx", "US"],
    ["AVGO", "博通", "bt", "US"], ["QCOM", "高通", "gt", "US"]
  ];

  var DICT = RAW.map(function (r) {
    var m = r[3];
    var em, tx;
    if (m === "US") { em = "105." + r[0]; tx = "us" + r[0]; }
    else if (m === "HK") { em = "116." + r[0]; tx = "hk" + r[0]; }
    else {
      var isSH = r[0][0] === "6" || r[0][0] === "9" || r[0][0] === "5";
      em = (isSH ? "1." : "0.") + r[0];
      tx = (isSH ? "sh" : "sz") + r[0];
    }
    return { code: r[0], name: r[1], py: r[2].toLowerCase(), market: m, em: em, tx: tx };
  });

  // 默认展示的热门组合（A股 + 港股 + 美股，覆盖不同板块）
  var HOT = ["600519", "300750", "002594", "600036", "688981", "00700", "AAPL", "NVDA"];

  var MARKET_LABEL = { A: "A股", HK: "港股", US: "美股" };

  function hotSymbols() {
    return HOT.map(function (code) {
      var s = DICT.filter(function (d) { return d.code === code; })[0];
      return s ? s.name + "|" + s.em : null;
    }).filter(Boolean);
  }

  /** 本地匹配：代码 / 名称 / 拼音首字母 */
  function searchLocal(q, limit) {
    limit = limit || 8;
    q = (q || "").trim().toLowerCase();
    if (!q) return [];
    var exact = [], prefix = [], fuzzy = [];
    DICT.forEach(function (d) {
      var code = d.code.toLowerCase();
      if (code === q) exact.push(d);
      else if (code.indexOf(q) === 0 || d.py.indexOf(q) === 0) prefix.push(d);
      else if (d.name.indexOf(q) >= 0 || d.py.indexOf(q) > 0) fuzzy.push(d);
    });
    return exact.concat(prefix, fuzzy).slice(0, limit).map(function (d) {
      return { code: d.code, name: d.name, market: d.market, secid: d.em, tx: d.tx, label: MARKET_LABEL[d.market] };
    });
  }

  /** 在线搜索（东财 JSONP，覆盖全市场） */
  function searchOnline(q, cb) {
    if (typeof document === "undefined" || !q) return;
    var cbName = "emSug" + Math.random().toString(36).slice(2, 9);
    var script = document.createElement("script");
    var done = false;
    function cleanup() {
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    window[cbName] = function (resp) {
      done = true;
      var out = [];
      try {
        var rows = (resp && resp.QuotationCodeTable && resp.QuotationCodeTable.Data) || [];
        out = rows.map(function (r) {
          var st = r.SecurityTypeName || "";
          var market = /港股/.test(st) ? "HK" : (/美股/.test(st) ? "US" : (/基金|债|期权/.test(st) ? "OTHER" : "A"));
          return { code: r.Code, name: r.Name, py: r.PinYin, secid: r.QuoteID, market: market, label: st };
        }).filter(function (r) { return r.secid && r.market !== "OTHER"; });
      } catch (e) { out = []; }
      cleanup();
      cb(out);
    };
    script.onerror = function () { if (!done) { done = true; cleanup(); cb([]); } };
    setTimeout(function () { if (!done) { done = true; cleanup(); cb([]); } }, 5000);
    script.src = SUGGEST_API + "?input=" + encodeURIComponent(q) + "&type=14&token=" + TOKEN +
      "&count=8&cb=" + cbName;
    document.head.appendChild(script);
  }

  return {
    dict: DICT,
    hotSymbols: hotSymbols,
    searchLocal: searchLocal,
    searchOnline: searchOnline,
    marketLabel: function (m) { return MARKET_LABEL[m] || m; }
  };
});