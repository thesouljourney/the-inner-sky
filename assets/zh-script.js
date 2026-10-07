/* ============================================================
   简 / 繁 显示切换(首页 index.html 与 app.html 共用)
   ------------------------------------------------------------
   · 资料一律照旧以简体存放(解读、收藏、记录都不动、不重新生成),
     选「繁」时只在显示的那一刻用 OpenCC 转成台湾正体(含台湾用语,
     例如 软件→軟體、信息→資訊)。切回「简」就是原本的样子。
   · 选择记在 localStorage(inner_sky_script_v1 = "s" | "t"),
     切换时直接重新载入页面 —— 两个方向都最单纯、不会有半转半不转。
   · 转换器(assets/vendor/opencc-full.js,约 500KB gzip)只有选了「繁」
     才会下载。载入前先把页面藏起来,转完再显示,不会先闪一下简体;
     万一转换器载不到,最多等 4 秒就照简体显示,不会白屏。
   · 不转换:使用者正在输入的文字(textarea / input 的值、contenteditable)、
     script / style。只转画面上看得到的文字与 placeholder / title /
     aria-label / alt 这几个属性;data-* 属性一律不碰(收藏的 key 靠它)。
   · 收藏时画面上是繁体,存进去之前用 ZhScript.toS() 转回简体,
     这样同一句话不会因为切换过简繁而变成两笔收藏。
   ============================================================ */
(function () {
  "use strict";
  var KEY = "inner_sky_script_v1";
  var mode = "s";
  try { if (localStorage.getItem(KEY) === "t") mode = "t"; } catch (e) { }

  var root = document.documentElement;
  var base = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/zh-script\.js(\?.*)?$/, "") : "assets/";
  })();

  var toT = null, toS = null;
  var api = {
    mode: mode,
    set: function (m) {
      m = m === "t" ? "t" : "s";
      if (m === mode) return;
      try { localStorage.setItem(KEY, m); } catch (e) { }
      location.reload();
    },
    // 画面上的繁体 → 资料用的简体(收藏时用);简体模式或转换器还没好时原样返回
    toS: function (text) { return (mode === "t" && toS) ? toS(String(text)) : text; },
    // 点击「简 / 繁」按钮:任何带 data-zh-script="s|t" 的元素都可以
    bind: function (scope) {
      (scope || document).querySelectorAll("[data-zh-script]").forEach(function (b) {
        var on = b.getAttribute("data-zh-script") === mode;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
  };
  window.ZhScript = api;
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-zh-script]");
    if (!b) return;
    ev.preventDefault();
    api.set(b.getAttribute("data-zh-script"));
  });
  document.addEventListener("DOMContentLoaded", function () { api.bind(); });

  if (mode !== "t") return;

  /* ---------- 以下只在「繁」模式执行 ---------- */
  root.classList.add("zh-tw", "zh-tw-pending");
  root.setAttribute("lang", "zh-Hant-TW");

  // 繁体字形用 TC 字体;规则(标题宋体 / 正文黑体)不变,只换字形
  var css = document.createElement("style");
  css.textContent =
    "html.zh-tw-pending body{visibility:hidden}" +
    "html.zh-tw{--font-serif-sc:\"Noto Serif TC\",\"Noto Serif SC\",\"Songti TC\",Georgia,serif;" +
    "--font-sans-sc:\"Noto Sans TC\",\"Noto Sans SC\",\"PingFang TC\",\"Helvetica Neue\",Arial,sans-serif}" +
    "html.zh-tw #dpage{--dp-serif:\"Noto Serif TC\",\"Noto Serif SC\",Georgia,serif;" +
    "--dp-song:\"Noto Serif TC\",\"Noto Serif SC\",Georgia,serif;" +
    "--dp-sans:\"Noto Sans TC\",\"Noto Sans SC\",\"Helvetica Neue\",Arial,sans-serif}";
  document.head.appendChild(css);
  var fl = document.createElement("link");
  fl.rel = "stylesheet";
  fl.href = "https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@300;400;500;600;700&family=Noto+Sans+TC:wght@300;400;500&display=swap";
  document.head.appendChild(fl);

  var reveal = function () { root.classList.remove("zh-tw-pending"); };
  var guard = setTimeout(reveal, 4000);   // 转换器载不到也不会白屏

  var CJK = /[㐀-鿿]/;
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 };
  var ATTRS = ["placeholder", "title", "aria-label", "alt"];

  function skip(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (SKIP[n.nodeName] || n.isContentEditable) return true;
    }
    return false;
  }
  function convAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (v && CJK.test(v)) { var t = toT(v); if (t !== v) el.setAttribute(ATTRS[i], t); }
    }
  }
  function convTree(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      var v = node.nodeValue;
      if (v && CJK.test(v) && !skip(node.parentNode)) { var t = toT(v); if (t !== v) node.nodeValue = t; }
      return;
    }
    if (node.nodeType !== 1 || SKIP[node.nodeName]) return;
    if (skip(node)) return;
    convAttrs(node);
    var w = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return (SKIP[n.nodeName] || n.isContentEditable) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        return CJK.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    var n, texts = [];
    while ((n = w.nextNode())) {
      if (n.nodeType === 1) convAttrs(n); else texts.push(n);
    }
    texts.forEach(function (t) { var o = t.nodeValue, c = toT(o); if (c !== o) t.nodeValue = c; });
  }
  function convTitle() {
    var t = document.title;
    if (t && CJK.test(t)) { var c = toT(t); if (c !== t) document.title = c; }
  }

  function start() {
    var O = window.OpenCC;
    if (!O) { clearTimeout(guard); reveal(); return; }
    // OpenCC 台湾用语转换之后,再补几个它在这个网站的语境里转得不够道地的词
    var FIX = [[/賬/g, "帳"], [/郵箱/g, "信箱"], [/連線經歷/g, "連結經歷"], [/登(\s*)錄/g, "登$1入"]];
    var rawT = O.Converter({ from: "cn", to: "twp" });
    toT = function (s) {
      s = rawT(s);
      for (var i = 0; i < FIX.length; i++) s = s.replace(FIX[i][0], FIX[i][1]);
      return s;
    };
    toS = O.Converter({ from: "twp", to: "cn" });
    var go = function () {
      convTree(document.body);
      convTitle();
      clearTimeout(guard);
      reveal();
      // 之后所有动态渲染(内页、解读、收藏…)都会经过这里
      new MutationObserver(function (list) {
        list.forEach(function (m) {
          if (m.type === "characterData") convTree(m.target);
          else if (m.type === "attributes") { if (!skip(m.target)) convAttrs(m.target); }
          else m.addedNodes.forEach(convTree);
        });
        convTitle();
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
      new MutationObserver(convTitle).observe(document.querySelector("title") || document.head, { childList: true, subtree: true, characterData: true });
    };
    if (document.body) go(); else document.addEventListener("DOMContentLoaded", go);
  }
  var s = document.createElement("script");
  s.src = base + "vendor/opencc-full.js";
  s.onload = start;
  s.onerror = function () { clearTimeout(guard); reveal(); };
  document.head.appendChild(s);
})();
