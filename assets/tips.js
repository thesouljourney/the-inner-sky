/* ============================================================
   第一次使用的小提示(首页 index.html 与 app.html 共用)
   ------------------------------------------------------------
   · 每一则提示 = 一个小泡泡,指着「这一页先点哪里」。
   · 每一则只出现一次:点「知道了」或直接点了它指的那个东西,就记下来,
     之后不再出现(记在 localStorage inner_sky_tips_v1,只是这台装置上的
     小方便;读不到就当作都没看过,不影响任何功能)。
   · 一次只出现一则;指的东西要真的在画面上(看得到、在视窗里)才出现,
     所以往下捲到那里时才会跳出来,不会指着看不见的地方。
   · 用法:Tips.add([{ id, sel, text, when? }]) —— sel 是要指的元素,
     when() 回传 false 时这一则先不出现(例如还没登录)。
   ============================================================ */
(function () {
  "use strict";
  var KEY = "inner_sky_tips_v1";
  var rules = [];
  var seen = {};
  try { seen = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { seen = {}; }

  function mark(id) {
    seen[id] = 1;
    try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch (e) { }
  }

  var css = document.createElement("style");
  css.textContent =
    ".is-tip{position:fixed;z-index:9000;max-width:min(260px,calc(100vw - 32px));box-sizing:border-box;" +
    "padding:12px 14px 10px;border-radius:14px;background:#fffdf9;border:1px solid rgba(201,178,140,.55);" +
    "box-shadow:0 14px 34px -10px rgba(40,34,90,.28);color:#2f3142;" +
    "font-family:\"Noto Sans SC\",\"PingFang SC\",\"Helvetica Neue\",Arial,sans-serif;" +
    "opacity:0;transform:translateY(4px);transition:opacity .25s ease,transform .25s ease;pointer-events:auto}" +
    ".is-tip.on{opacity:1;transform:none}" +
    ".is-tip .k{display:flex;align-items:center;gap:6px;margin:0 0 4px;font-size:11.5px;letter-spacing:.12em;color:#a07d4e}" +
    ".is-tip .k i{font-style:normal;font-size:10px}" +
    ".is-tip p{margin:0;font-size:13px;line-height:1.75;letter-spacing:.01em;text-wrap:pretty}" +
    ".is-tip button{display:block;margin:8px 0 0 auto;padding:4px 12px;border:0;border-radius:999px;cursor:pointer;" +
    "background:linear-gradient(135deg,#c9c0e2,#f4d8d5);color:#4e4673;font:inherit;font-size:12px;letter-spacing:.06em}" +
    ".is-tip .ar{position:absolute;width:12px;height:12px;background:#fffdf9;transform:rotate(45deg);" +
    "border:1px solid rgba(201,178,140,.55)}" +
    ".is-tip.below .ar{top:-7px;border-right:0;border-bottom:0}" +
    ".is-tip.above .ar{bottom:-7px;border-left:0;border-top:0}" +
    "@media (prefers-reduced-motion:reduce){.is-tip{transition:none}}";
  document.head.appendChild(css);

  var cur = null;   // { rule, el, box }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    // 至少要露出一截,并且不能还压在最上面的导航列底下
    return r.bottom > 80 && r.top < vh - 60;
  }
  function blocked() {
    // 登录 / 载入的全屏遮罩还在时不出现
    var a = document.getElementById("authOverlay");
    return !!(a && a.style.display !== "none" && a.offsetParent !== null);
  }

  function place() {
    if (!cur) return;
    var el = cur.el, box = cur.box;
    if (!el.isConnected) { close(false); return; }
    var r = el.getBoundingClientRect();
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var bw = box.offsetWidth, bh = box.offsetHeight;
    var below = r.bottom + 12 + bh <= vh - 8 || r.top - 12 - bh < 8;
    var top = below ? r.bottom + 12 : r.top - 12 - bh;
    var cx = r.left + r.width / 2;
    var left = Math.max(16, Math.min(vw - 16 - bw, cx - bw / 2));
    box.classList.toggle("below", below);
    box.classList.toggle("above", !below);
    box.style.top = Math.round(top) + "px";
    box.style.left = Math.round(left) + "px";
    var ar = box.querySelector(".ar");
    ar.style.left = Math.round(Math.max(14, Math.min(bw - 26, cx - left - 6))) + "px";
  }

  function close(remember) {
    if (!cur) return;
    var c = cur; cur = null;
    if (remember) mark(c.rule.id);
    c.el.removeEventListener("click", c.onTarget, true);
    c.box.classList.remove("on");
    setTimeout(function () { c.box.remove(); }, 260);
    if (remember) setTimeout(scan, 500);   // 同一页还有下一则就接着出来
  }

  function show(rule, el) {
    var box = document.createElement("div");
    box.className = "is-tip below";
    box.setAttribute("role", "status");
    box.innerHTML = '<span class="ar" aria-hidden="true"></span>' +
      '<div class="k"><i aria-hidden="true">✦</i>小提示</div><p></p>' +
      '<button type="button">知道了</button>';
    box.querySelector("p").textContent = rule.text;
    document.body.appendChild(box);
    var onTarget = function () { close(true); };
    cur = { rule: rule, el: el, box: box, onTarget: onTarget };
    box.querySelector("button").addEventListener("click", function () { close(true); });
    // 直接点了它指的东西 = 已经知道了
    el.addEventListener("click", onTarget, true);
    place();
    requestAnimationFrame(function () { box.classList.add("on"); });
  }

  function scan() {
    if (cur) {
      // 页面换了、指的东西不见了,就先收起来(没记成看过,之后还会再出现)
      if (!cur.el.isConnected || (cur.rule.when && !cur.rule.when())) close(false);
      else { place(); return; }
    }
    if (blocked()) return;
    for (var i = 0; i < rules.length; i++) {
      var rl = rules[i];
      if (seen[rl.id]) continue;
      try { if (rl.when && !rl.when()) continue; } catch (e) { continue; }
      var el = document.querySelector(rl.sel);
      if (visible(el)) { show(rl, el); return; }
    }
  }

  var t = 0;
  function soon(ms) { clearTimeout(t); t = setTimeout(scan, ms == null ? 350 : ms); }
  var raf = 0;
  function onMove() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; if (cur) place(); soon(250); });
  }
  window.addEventListener("scroll", onMove, { passive: true });
  window.addEventListener("resize", onMove);
  window.addEventListener("hashchange", function () { close(false); soon(900); });
  function boot() {
    // 页面是动态渲染的(内页、展开的内容…),内容一变就重新找一次
    new MutationObserver(function () { soon(); }).observe(document.body, { childList: true, subtree: true });
    soon(1200);
  }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot);

  window.Tips = {
    add: function (list) { rules = rules.concat(list || []); soon(); },
    reset: function () { seen = {}; try { localStorage.removeItem(KEY); } catch (e) { } soon(); }
  };
})();
