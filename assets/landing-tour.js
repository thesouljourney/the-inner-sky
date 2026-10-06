/* ============================================================
   首页导览(只有 index.html 用)
   ------------------------------------------------------------
   · 7 步,依序:Hero → 在这里你可以 → 我的星空 → 九个主题 →
     属于我的生命脉络 → 内在指南 / 星空记录 / 收藏 → 回到 Hero。
     文案照用户提供的原文,不改写。
   · 每一步:平滑捲到那一块,并在那一块外面加一圈很淡的香槟金光
     (只用 outline / box-shadow,不改动原本版面);说明卡固定在画面
     下方(手机置中、电脑靠右),有「上一步 / 下一步」与关闭。
     最后一步的按钮是「开启我的星空 ✦」,直接走 Hero 那颗按钮的连结。
   · 第一次进首页先出现欢迎卡:「开始导览 / 先自己看看」。
     看过就记在 localStorage(inner_sky_tour_v1),之后不再自动出现;
     顶栏永远有「✦ 网站导览」可以重新开启。
   · 不用黑色厚遮罩:欢迎卡后面只有一层很淡的珍珠白,导览时完全没有遮罩。
   ============================================================ */
(function () {
  "use strict";
  var KEY = "inner_sky_tour_v1";

  var STEPS = [
    { sel: ".hero-copy .btn-primary", pill: true, title: "欢迎来到 The Inner Sky",
      body: "从这里开始，认识属于你的生命蓝图" },
    { sel: ".here .wrap", title: "在这里，你可以",
      body: "读懂自己的星盘、探索人生主题，也留下每天的感受与问题" },
    { sel: "#sky .sky-card", title: "我的星空",
      body: "你的完整星盘都在这里\n每一颗星，都藏着认识自己的线索" },
    { sel: "#chapters .wrap", title: "九个主题",
      body: "点一颗星星，进入不同的人生主题\n读过的星星，会慢慢亮起来" },
    { sel: ".thread-band .thread-in", title: "属于我的生命脉络",
      body: "当你读过更多主题，\n它们会慢慢连成属于你的故事" },
    { sel: ".guide-card", title: "留下属于你的记录",
      body: "在「我的内在指南」写下今天的自己\n写过的感受会收进「我的星空记录」，喜欢的句子也可以收藏起来",
      also: [".rec-card", "#favs"] },
    { sel: ".hero-copy", title: "从这里开始",
      body: "这里不是替你定义人生，而是陪你一点一点看见自己\n不需要按照顺序，从现在最想知道的地方开始就好",
      last: true }
  ];

  var css = document.createElement("style");
  css.textContent = [
    /* 当前区块:淡淡一圈香槟金,不占位置、不推挤版面 */
    ".tour-hl{outline:1.5px solid rgba(214,186,132,.85);outline-offset:10px;border-radius:22px;",
    "box-shadow:0 0 0 10px rgba(255,248,232,.16),0 0 46px 12px rgba(214,186,132,.28);",
    "transition:outline-color .4s ease,box-shadow .4s ease}",
    /* 胶囊按钮(第一步的「开启我的星空」):框跟着按钮的圆角,贴近一点 */
    ".tour-hl.tour-pill{border-radius:999px;outline-offset:6px;box-shadow:0 0 0 6px rgba(255,248,232,.14),0 0 30px 8px rgba(214,186,132,.35)}",
    /* 导览说明卡 */
    ".tour-card{position:fixed;z-index:9100;left:50%;bottom:20px;transform:translate(-50%,12px);",
    "width:min(380px,calc(100vw - 32px));box-sizing:border-box;padding:18px 20px 16px;border-radius:20px;",
    "background:linear-gradient(180deg,rgba(255,253,249,.97),rgba(250,245,238,.97));",
    "border:1px solid rgba(201,178,140,.55);box-shadow:0 18px 44px -14px rgba(28,32,80,.35);",
    "color:#2f3142;text-align:center;opacity:0;transition:opacity .3s ease,transform .3s ease;",
    "font-family:\"Noto Sans SC\",\"PingFang SC\",\"Helvetica Neue\",Arial,sans-serif}",
    ".tour-card.on{opacity:1;transform:translate(-50%,0)}",
    "@media (min-width:900px){.tour-card{left:auto;right:28px;bottom:28px;transform:translateY(12px)}",
    ".tour-card.on{transform:none}}",
    ".tour-card .tc-x{position:absolute;top:8px;right:10px;width:30px;height:30px;padding:0;border:0;border-radius:50%;",
    "background:none;cursor:pointer;font-size:18px;line-height:1;color:#a59cb6}",
    ".tour-card .tc-x:hover{color:#23264f;background:rgba(201,178,140,.14)}",
    ".tour-card .tc-n{display:flex;align-items:center;justify-content:center;gap:6px;font-size:11.5px;",
    "letter-spacing:.16em;color:#b0915c}",
    ".tour-card h3{margin:8px 0 6px;font-family:\"Noto Serif SC\",\"Songti SC\",Georgia,serif;font-weight:600;",
    "font-size:17px;letter-spacing:.06em;color:#23264f}",
    ".tour-card p{margin:0;font-size:13.5px;line-height:1.85;color:#4a4a63;white-space:pre-line;text-wrap:pretty}",
    ".tour-card .tc-dots{display:flex;justify-content:center;gap:6px;margin:14px 0 12px}",
    ".tour-card .tc-dots i{width:6px;height:6px;border-radius:50%;background:rgba(201,178,140,.35);transition:background .3s,transform .3s}",
    ".tour-card .tc-dots i.on{background:#c9a061;transform:scale(1.25)}",
    ".tour-card .tc-bt{display:flex;align-items:center;justify-content:center;gap:12px}",
    ".tour-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:0 18px;",
    "border-radius:999px;cursor:pointer;font-family:\"Noto Serif SC\",\"Songti SC\",Georgia,serif;font-size:13px;",
    "letter-spacing:.08em;text-decoration:none;transition:transform .2s,box-shadow .2s,background .2s}",
    ".tour-btn.pri{border:0;color:#fff;background:linear-gradient(135deg,#8176ad 0%,#c9a0b8 100%);",
    "box-shadow:0 8px 20px -8px rgba(60,50,120,.45)}",
    ".tour-btn.pri:hover{transform:translateY(-1px)}",
    ".tour-btn.sec{border:1px solid rgba(201,178,140,.6);background:rgba(255,253,249,.7);color:#5a5578}",
    ".tour-btn.sec:hover{background:#fff}",
    ".tour-btn[disabled]{opacity:.4;pointer-events:none}",
    /* 第一次的欢迎卡:后面只有一层很淡的珍珠白,不是黑色遮罩 */
    ".tour-veil{position:fixed;inset:0;z-index:9090;background:rgba(250,246,240,.22);",
    "-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);opacity:0;transition:opacity .35s ease}",
    ".tour-veil.on{opacity:1}",
    ".tour-welcome{position:fixed;z-index:9100;left:50%;top:50%;transform:translate(-50%,-46%);",
    "width:min(360px,calc(100vw - 40px));box-sizing:border-box;padding:28px 24px 22px;border-radius:24px;text-align:center;",
    "background:linear-gradient(180deg,rgba(255,253,249,.98),rgba(248,242,233,.98));",
    "border:1px solid rgba(201,178,140,.6);box-shadow:0 24px 60px -18px rgba(28,32,80,.45);",
    "opacity:0;transition:opacity .35s ease,transform .35s ease;font-family:\"Noto Sans SC\",\"PingFang SC\",Arial,sans-serif}",
    ".tour-welcome.on{opacity:1;transform:translate(-50%,-50%)}",
    ".tour-welcome .tw-st{font-size:18px;color:#c9a061}",
    ".tour-welcome h3{margin:8px 0 22px;font-family:\"Noto Serif SC\",\"Songti SC\",Georgia,serif;font-weight:600;",
    "font-size:19px;letter-spacing:.08em;color:#23264f}",
    ".tour-welcome h3 .g{color:#c9a061}",
    ".tour-welcome p{margin:0 0 20px;font-size:13px;line-height:1.85;color:#6a6680}",
    ".tour-welcome .tc-bt{display:flex;flex-direction:column;align-items:stretch;gap:10px}",
    ".tour-welcome .tour-btn{min-height:42px;font-size:14px}",
    /* 顶栏的「✦ 网站导览」:跟旁边的简 / 繁、登入按钮同一套深蓝半透明底 */
    ".nav-tour{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:999px;cursor:pointer;",
    "border:1px solid rgba(255,244,222,.7);background:rgba(20,24,64,.55);color:#fff;white-space:nowrap;",
    "-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 4px 14px rgba(10,12,40,.25);",
    "text-shadow:0 1px 4px rgba(10,12,40,.5);font-family:var(--font-serif-sc,serif);font-size:13px;letter-spacing:.04em}",
    ".nav-tour:hover{background:rgba(28,32,80,.7)}",
    ".nav-tour .g{color:#e8d3a2}",
    ".nav-tour .s{display:none}",
    "@media (max-width:640px){.nav-tour{padding:5px 9px;font-size:11.5px}.nav-tour .l{display:none}.nav-tour .s{display:inline}}",
    ".nav-user-menu .m-tour{display:none}",
    /* 很窄的手机:只留一颗 ✦ 圆钮;没登录时顶栏还有「菜单」与「注册 / 登入」放不下,改成「菜单」里的第一项 */
    "@media (max-width:480px){.nav-tour{width:30px;height:30px;padding:0;justify-content:center}.nav-tour .s{display:none}",
    ".nav-tour.guest{display:none}.nav-user-menu .m-tour{display:block}}",
    ".tour-btn:focus{outline:none}.tour-btn:focus-visible,.tour-card .tc-x:focus-visible,.nav-tour:focus-visible{outline:2px solid rgba(201,160,97,.75);outline-offset:2px}",
    "@media (prefers-reduced-motion:reduce){.tour-card,.tour-welcome,.tour-veil,.tour-hl{transition:none}}"
  ].join("");
  document.head.appendChild(css);

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  var cur = -1, card = null, hl = [];

  function remember() { try { localStorage.setItem(KEY, "seen"); } catch (e) { } }
  function wasSeen() { try { return localStorage.getItem(KEY) === "seen"; } catch (e) { return false; } }
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function clearHl() { hl.forEach(function (el) { el.classList.remove("tour-hl", "tour-pill"); }); hl = []; }

  /* 捲到这一步的区块:放得下就置中,太高就让顶端停在导航列下面一点 */
  function scrollTo(el) {
    var r = el.getBoundingClientRect(), vh = window.innerHeight;
    var cardH = card ? card.offsetHeight + 40 : 220;
    var room = vh - cardH;
    var y = window.scrollY + r.top - (r.height < room - 40 ? Math.max(24, (room - r.height) / 2) : 24);
    // 在第一屏里的东西(Hero 的按钮)直接回到页首,不要把标题捲掉
    if (window.scrollY + r.bottom < room) y = 0;
    window.scrollTo({ top: Math.max(0, y), behavior: reduce ? "auto" : "smooth" });
  }

  function render() {
    var s = STEPS[cur], n = STEPS.length;
    card.innerHTML =
      '<button type="button" class="tc-x" aria-label="关闭导览">×</button>' +
      '<div class="tc-n"><span aria-hidden="true">✦</span>' + (cur + 1) + " / " + n + "</div>" +
      '<h3 id="tourTitle">' + esc(s.title) + "</h3><p>" + esc(s.body) + "</p>" +
      '<div class="tc-dots" aria-hidden="true">' + STEPS.map(function (x, i) { return '<i' + (i === cur ? ' class="on"' : "") + "></i>"; }).join("") + "</div>" +
      '<div class="tc-bt">' +
      '<button type="button" class="tour-btn sec tc-prev"' + (cur === 0 ? " disabled" : "") + ">上一步</button>" +
      (s.last
        ? '<a class="tour-btn pri tc-go" href="' + esc(heroHref()) + '">开启我的星空 ✦</a>'
        : '<button type="button" class="tour-btn pri tc-next">下一步</button>') +
      "</div>";
    card.querySelector(".tc-x").addEventListener("click", function () { end(); });
    card.querySelector(".tc-prev").addEventListener("click", function () { go(cur - 1); });
    var nx = card.querySelector(".tc-next");
    if (nx) nx.addEventListener("click", function () { go(cur + 1); });
    var gl = card.querySelector(".tc-go");
    if (gl) gl.addEventListener("click", function () { remember(); });
  }

  function heroHref() {
    var a = $(".hero-copy .btn-primary");
    return a ? a.getAttribute("href") : "app.html#/reading";
  }

  function go(i) {
    if (i < 0 || i >= STEPS.length) return;
    cur = i;
    var s = STEPS[i];
    var el = $(s.sel);
    clearHl();
    [s.sel].concat(s.also || []).forEach(function (q) {
      var e = $(q);
      if (e) { e.classList.add("tour-hl"); if (s.pill) e.classList.add("tour-pill"); hl.push(e); }
    });
    render();
    if (el) scrollTo(el);
  }

  function start() {
    closeWelcome();
    if (!card) {
      card = document.createElement("div");
      card.className = "tour-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-labelledby", "tourTitle");
      document.body.appendChild(card);
      requestAnimationFrame(function () { card.classList.add("on"); });
    }
    go(0);
  }

  function end() {
    remember();
    clearHl();
    cur = -1;
    if (card) {
      var c = card; card = null;
      c.classList.remove("on");
      setTimeout(function () { c.remove(); }, 300);
    }
  }

  /* ---------- 第一次来的欢迎卡 ---------- */
  var veil = null, wel = null;
  function closeWelcome() {
    [veil, wel].forEach(function (e) {
      if (!e) return;
      e.classList.remove("on");
      setTimeout(function () { e.remove(); }, 350);
    });
    veil = wel = null;
  }
  function welcome() {
    veil = document.createElement("div");
    veil.className = "tour-veil";
    wel = document.createElement("div");
    wel.className = "tour-welcome";
    wel.setAttribute("role", "dialog");
    wel.setAttribute("aria-labelledby", "tourWelT");
    wel.innerHTML =
      '<div class="tw-st" aria-hidden="true">✦</div>' +
      '<h3 id="tourWelT">第一次来到这里吗？<span class="g">✦</span></h3>' +
      '<div class="tc-bt"><button type="button" class="tour-btn pri tw-go">开始导览</button>' +
      '<button type="button" class="tour-btn sec tw-no">先自己看看</button></div>';
    document.body.appendChild(veil);
    document.body.appendChild(wel);
    wel.querySelector(".tw-go").addEventListener("click", start);
    var no = function () { remember(); closeWelcome(); };
    wel.querySelector(".tw-no").addEventListener("click", no);
    veil.addEventListener("click", no);
    requestAnimationFrame(function () { veil.classList.add("on"); wel.classList.add("on"); });
  }

  document.addEventListener("keydown", function (e) {
    if (wel && e.key === "Escape") { remember(); closeWelcome(); return; }
    if (cur < 0) return;
    if (e.key === "Escape") end();
    else if (e.key === "ArrowRight" && cur < STEPS.length - 1) go(cur + 1);
    else if (e.key === "ArrowLeft") go(cur - 1);
  });

  /* 顶栏的「✦ 网站导览」:任何时候都能重新开启 */
  function navButton() {
    var right = $(".nav-right");
    if (!right || $(".nav-tour")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "nav-tour";
    b.setAttribute("aria-label", "网站导览");
    b.innerHTML = '<span class="g" aria-hidden="true">✦</span><span class="l">网站导览</span><span class="s">导览</span>';
    b.addEventListener("click", function () { if (cur < 0) start(); });
    var cta = document.getElementById("navCta");
    if (cta && !cta.hidden) b.classList.add("guest");
    right.insertBefore(b, right.firstChild);
    // 没登录的窄画面:「菜单」里也放一项(CSS 只在 ≤480px 显示)
    var list = document.getElementById("navMenuList");
    if (list && !list.querySelector(".m-tour")) {
      var m = document.createElement("a");
      m.setAttribute("role", "menuitem");
      m.href = "#";
      m.className = "m-tour";
      m.innerHTML = '<span style="color:#c9a061">✦</span> 网站导览';
      m.addEventListener("click", function (e) { e.preventDefault(); if (cur < 0) start(); });
      list.insertBefore(m, list.firstChild);
    }
  }

  function boot() {
    navButton();
    if (!wasSeen()) setTimeout(function () { if (cur < 0 && !wel) welcome(); }, 1200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.LandingTour = { start: start, end: end };
})();
