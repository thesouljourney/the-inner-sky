/* ============================================================
   中文标点统一(首页 index.html 与 app.html 共用)
   ------------------------------------------------------------
   · AI 写的解读、已经存下来的旧资料里,偶尔会夹着英文半角标点
     (「别人眼中的你,和你自己」),在中文里会显得很挤。
   · 这里只在「显示的那一刻」把紧贴着中文的半角 , ? ! ; : 换成全角
     ,?!;: —— 资料本身(解读、收藏、记录)一个字都不改,
     收藏的比对 key 也不受影响。
   · 只动画面上的文字节点;使用者正在输入的内容(textarea / input /
     contenteditable)、script、style、code 一律不碰。
   · 英文与数字之间的标点不动(例如 1,000、http://、12:30)。
   ============================================================ */
(function () {
  "use strict";
  var C = "[㐀-鿿「-』（）《》]";
  var HAS = new RegExp(C + "\\s*[,?!;:]|[,]\\s*" + C);
  var R = [
    [new RegExp("(" + C + "),[ \\t]*", "g"), "$1，"],
    [new RegExp("(^|[^0-9A-Za-z]),[ \\t]*(?=" + C + ")", "g"), "$1，"],
    [new RegExp("(" + C + ")\\?", "g"), "$1？"],
    [new RegExp("(" + C + ")!", "g"), "$1！"],
    [new RegExp("(" + C + ");", "g"), "$1；"],
    [new RegExp("(" + C + "):(?![0-9/])", "g"), "$1："]
  ];
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 };

  function fix(s) {
    for (var i = 0; i < R.length; i++) s = s.replace(R[i][0], R[i][1]);
    return s;
  }
  function skip(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (SKIP[n.nodeName] || n.isContentEditable) return true;
    }
    return false;
  }
  function text(node) {
    var v = node.nodeValue;
    if (!v || !HAS.test(v) || skip(node.parentNode)) return;
    var f = fix(v);
    if (f !== v) node.nodeValue = f;
  }
  function tree(node) {
    if (!node) return;
    if (node.nodeType === 3) { text(node); return; }
    if (node.nodeType !== 1 || SKIP[node.nodeName] || skip(node)) return;
    var w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return HAS.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; }
    });
    var list = [], n;
    while ((n = w.nextNode())) list.push(n);
    list.forEach(text);
  }
  function boot() {
    tree(document.body);
    // 之后所有动态渲染(内页、解读、收藏…)都会经过这里
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === "characterData") text(m.target);
        else m.addedNodes.forEach(tree);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot);
  window.ZhPunct = { fix: fix };
})();
