/* ============================================================
   最小 Deno 垫片 —— 只为了在 Node 里【真的执行】Edge Function 的原始码
   ------------------------------------------------------------
   这不是把 compass-generate.ts 重写一遍,而是把那个档案原封不动载进来跑:
     · Deno.serve(handler)  → 捕获 handler,挂到一个真的 node:http server 上
     · Deno.env.get(k)      → process.env[k]
   所以 scrub、路由、错误分支、CORS 全部走的是那份档案自己的程式码。

   只在开发期使用。不进产品,也不参与任何建置。
   ============================================================ */
const http = require("http");
const path = require("path");

function installDeno(env) {
  let captured = null;
  globalThis.Deno = {
    env: { get: (k) => (env && env[k] !== undefined ? env[k] : process.env[k]) },
    serve: (h) => { captured = h; return { finished: Promise.resolve() }; }
  };
  return () => captured;
}

/* 载入 .ts 原始码并跑起来。回传 { url, close, handler } */
async function serveEdgeFunction(tsPath, opts) {
  opts = opts || {};
  const getHandler = installDeno(opts.env);
  /* Node 22 的 --experimental-strip-types 只吃 import();require() 不会剥型别 */
  await import(path.isAbsolute(tsPath) ? "file://" + tsPath : tsPath);
  const handler = getHandler();
  if (typeof handler !== "function") throw new Error("Deno.serve 没有被呼叫:" + tsPath);

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const url = "http://" + (req.headers.host || "127.0.0.1") + req.url;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: (req.method === "GET" || req.method === "HEAD") ? undefined : body
    });
    let out;
    try { out = await handler(request); }
    catch (e) { out = new Response(JSON.stringify({ error: String(e) }), { status: 500 }); }
    res.statusCode = out.status;
    out.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  /* 就算呼叫端忘了 close(或中途抛错),也不要让这个 server 卡住 node 的事件圈 */
  server.unref();
  const port = server.address().port;
  return {
    url: "http://127.0.0.1:" + port,
    handler,
    close: () => new Promise((ok) => server.close(ok))
  };
}

/* 把上游 Anthropic 换成本地假回应 —— 用来在【没有金钥】的情况下
   仍然把「浏览器 → HTTP → Edge Function → 解析 → 验证 → UI」整条走完。
   回传一个还原函式。任何时候都不会碰到真的 API。 */
function stubAnthropic(textFor) {
  const real = globalThis.fetch;
  globalThis.fetch = function (url, init) {
    if (String(url).indexOf("api.anthropic.com") >= 0) {
      const body = JSON.parse((init && init.body) || "{}");
      const text = textFor(body);
      if (text === null)
        return Promise.resolve(new Response("upstream stub: forced failure", { status: 529 }));
      return Promise.resolve(new Response(JSON.stringify({
        content: [{ type: "text", text: text }],
        usage: { input_tokens: 0, output_tokens: 0 },
        model: "stub"
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return real.apply(this, arguments);
  };
  return () => { globalThis.fetch = real; };
}

module.exports = { serveEdgeFunction, stubAnthropic };
