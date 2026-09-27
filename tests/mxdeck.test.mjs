// mxdeck に実際に読み込ませて、サインイン → 取得 までを通す。
// ローカルの http サーバーをサービスに見立てた定義（JSON と JS）を config.services で足す。
//
//   MXDECK_DIR=../mxdeck node --test tests/mxdeck.test.mjs   （既定は隣の ../mxdeck）
//
// mxdeck が無ければ飛ばす。クリップボードには触らない（コピーは試さない）。
// ポートは OS に空きを選ばせる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const mxdeck = path.resolve(process.env.MXDECK_DIR ?? path.join(root, "..", "mxdeck"));
const hasMxdeck = fs.existsSync(path.join(mxdeck, "src", "plugins.js"));

const SESSION = "sess-0123456789abcdef";
const CSRF = "csrf-fedcba9876543210";
const TOKEN = "tok-aaaaaaaaaaaaaaaa";

function serve() {
  return new Promise((resolve) => {
    const s = http
      .createServer((req, res) => {
        res.setHeader("content-type", "text/html");
        if (req.url === "/login") {
          res.setHeader("set-cookie", [`session=${SESSION}; HttpOnly; Path=/`, `csrf_token=${CSRF}; Path=/`]);
          res.end(`<title>signed in</title><script>localStorage.setItem("tok", "${TOKEN}")</script>`);
        } else if (req.url === "/guest") {
          // サインイン前から Cookie を置くサービス（X の guest_id のようなもの）
          res.setHeader("set-cookie", ["guest_id=g-0123456789; Path=/"]);
          res.end("<title>sign in</title>");
        } else if (req.url === "/away") {
          // 別のオリジン（localhost）の /login へ。そこでも tok が置かれるので、オリジンを確かめずに読むと取れてしまう
          const port = req.headers.host.split(":")[1];
          res.writeHead(302, { location: `http://localhost:${port}/login` }).end();
        } else {
          res.end("<title>page</title>");
        }
      })
      .listen(0, "127.0.0.1", () => resolve(s));
  });
}

// main プロセスの inspector に繋いで式を評価する
async function inspector(child) {
  let timer;
  const url = await new Promise((resolve, reject) => {
    let buf = "";
    child.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) resolve(m[0]);
    });
    timer = setTimeout(() => reject(new Error(`no inspector: ${buf}`)), 20_000);
  }).finally(() => clearTimeout(timer));
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    pending.get(msg.id)?.(msg);
  });
  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (msg) => {
        const r = msg.result;
        if (msg.error || r?.exceptionDetails) reject(new Error(JSON.stringify(msg.error ?? r.exceptionDetails)));
        else resolve(r.result.value);
      });
      ws.send(
        JSON.stringify({
          id: n,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
  return { evaluate, close: () => ws.close() };
}

test("in mxdeck: sign in, then get the command; the panel never sees the full values", { skip: !hasMxdeck && "mxdeck not found" }, async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-mxdeck-"));
  const jsonDef = path.join(tmp, "local.json");
  const jsDef = path.join(tmp, "local-js.js");
  fs.writeFileSync(
    jsonDef,
    JSON.stringify({
      id: "local",
      name: "Local",
      bridge: "local-bridge",
      signInUrl: `${origin}/login`,
      signedInWhen: ["session"],
      read: {
        cookies: { session: { url: origin, name: "session" }, csrf: { url: origin, name: "csrf_token" } },
      },
      command: "login {session} {csrf}",
    }),
  );
  // サインインのページを開いただけでは session が無い。Cookie があっても「サインインしていない」
  const guestDef = path.join(tmp, "guest.json");
  fs.writeFileSync(
    guestDef,
    JSON.stringify({
      id: "guest",
      name: "Guest",
      signInUrl: `${origin}/guest`,
      signedInWhen: ["session"],
      read: { cookies: { session: { url: origin, name: "session" } } },
      command: "login {session}",
    }),
  );
  fs.writeFileSync(
    jsDef,
    `module.exports = {
      id: "local-js", name: "Local JS", signInUrl: ${JSON.stringify(`${origin}/login`)},
      read: {
        localStorage: { url: ${JSON.stringify(`${origin}/`)}, keys: { tok: "tok" } },
        page: { url: ${JSON.stringify(`${origin}/`)}, run: () => document.title },
      },
      build: ({ localStorage, page }, { UserError }) => {
        if (!localStorage.tok) throw new UserError({ en: "no tok", ja: "tok が無い" });
        return [{ title: page, text: "login " + localStorage.tok, secrets: [] }];
      },
      describe: ({ page }) => [page + " user"],
    };`,
  );
  // 読みに行ったページが別のオリジンへ転送されたら、そこの localStorage は読まない
  const awayDef = path.join(tmp, "away.json");
  fs.writeFileSync(
    awayDef,
    JSON.stringify({
      id: "away",
      name: "Away",
      signInUrl: `${origin}/login`,
      read: { localStorage: { url: `${origin}/away`, keys: { tok: "tok" } } },
      command: "login {tok}",
    }),
  );
  // { file, options } で渡した options から、定義を複数つくる
  const factoryDef = path.join(tmp, "factory.js");
  fs.writeFileSync(
    factoryDef,
    `module.exports = (options) => options.accounts.map((a) => ({
      id: "multi-" + a, name: "Multi " + a, signInUrl: ${JSON.stringify(`${origin}/login`)},
      read: { cookies: { session: { url: ${JSON.stringify(origin)}, name: "session" } } },
      command: "login {session}",
    }));`,
  );
  // アカウントが 0 件だと mxdeck は「追加」のシートを出し、パネル（これもシート）がその後ろで待たされる
  fs.writeFileSync(
    path.join(tmp, "accounts.json"),
    JSON.stringify({ accounts: [{ id: "a", name: "A", url: `${origin}/` }] }),
  );
  fs.writeFileSync(
    path.join(tmp, "plugins.json"),
    JSON.stringify({ plugins: [{ path: root, config: { services: [jsonDef, jsDef, awayDef, guestDef, { file: factoryDef, options: { accounts: ["a", "b"] } }] } }] }),
  );

  const electron = createRequire(path.join(mxdeck, "package.json"))("electron");
  const child = spawn(electron, [mxdeck, "--inspect=0"], {
    env: {
      ...process.env,
      MXDECK_USER_DATA: path.join(tmp, "ud"),
      MXDECK_ACCOUNTS: path.join(tmp, "accounts.json"),
      MXDECK_PLUGINS: path.join(tmp, "plugins.json"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const main = await inspector(child);
  try {
    const E = `process.mainModule.require("electron")`;
    // 起動を待ってから（inspector は起動処理の途中から繋がる）、プラグインのメニュー項目を押してパネルを開く
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; ; i++) {
      await sleep(300);
      const ready = await main
        .evaluate(`!!process.mainModule && ${E}.app.isReady() && !!${E}.Menu.getApplicationMenu()`)
        .catch(() => false);
      if (ready) break;
      if (i > 60) throw new Error("mxdeck did not start");
    }
    await main.evaluate(`(() => {
      const menu = ${E}.Menu.getApplicationMenu().items.find((i) => i.label === "プラグイン");
      menu.submenu.items.find((i) => /Bridge login|ブリッジのログイン/.test(i.label)).click();
    })()`);
    const inPanel = (js) =>
      main.evaluate(`(async () => {
        for (let i = 0; i < 50; i++) {
          const w = ${E}.BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("panel/panel.html"));
          if (w && !w.webContents.isLoading()) return w.webContents.executeJavaScript(${JSON.stringify(js)});
          await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error("panel did not open");
      })()`);

    const init = await inPanel(`window.mxdeck.invoke("init")`);
    assert.deepEqual(init.errors, []);
    assert.deepEqual(init.services.map((s) => s.id).sort(), ["away", "guest", "local", "local-js", "multi-a", "multi-b", "slack"]);

    // サインイン前: どちらも「サインインしていない」
    const before = await inPanel(`window.mxdeck.invoke("get", "local")`);
    assert.equal(before.ok, false);
    assert.match(before.message, /Local/);
    const beforeJs = await inPanel(`window.mxdeck.invoke("get", "local-js")`);
    assert.equal(beforeJs.ok, false);
    assert.match(beforeJs.message, /tok/);

    // サインイン（サイト用ウィンドウが /login を開き、Cookie と localStorage が入る）
    const cookiesIn = (id) =>
      main.evaluate(`${E}.session.fromPartition("persist:plugin-login-helper-${id}").cookies.get({}).then((c) => c.length)`);
    await inPanel(`window.mxdeck.invoke("sign-in", "local")`);
    await sleep(1500);
    assert.equal(await cookiesIn("local"), 2);
    // 保存領域はサービスごと: local でサインインしても local-js には何も入らない
    assert.equal(await cookiesIn("local-js"), 0);

    const siteWindows = (id) =>
      main.evaluate(`${E}.BrowserWindow.getAllWindows().filter((w) =>
        w.webContents.session === ${E}.session.fromPartition("persist:plugin-login-helper-${id}")).length`);
    assert.equal(await siteWindows("local"), 1);

    const got = await inPanel(`window.mxdeck.invoke("get", "local")`);
    assert.equal(got.ok, true, got.message);
    assert.equal(got.results[0].masked, "login sess***cdef csrf***3210");
    // 取れたらサインイン用のウィンドウは閉じる。サインイン（Cookie）は残り、もう一度取れる
    await sleep(500);
    assert.equal(await siteWindows("local"), 0);
    assert.equal((await inPanel(`window.mxdeck.invoke("get", "local")`)).ok, true);

    await inPanel(`window.mxdeck.invoke("sign-in", "local-js")`);
    await sleep(1500);
    const gotJs = await inPanel(`window.mxdeck.invoke("get", "local-js")`);
    assert.equal(gotJs.ok, true, gotJs.message);
    assert.equal(gotJs.results[0].title, "page");
    assert.equal(gotJs.results[0].masked, "login tok-***aaaa");

    await inPanel(`window.mxdeck.invoke("sign-in", "away")`);
    await sleep(1500);
    const away = await inPanel(`window.mxdeck.invoke("get", "away")`);
    assert.equal(away.ok, false, "転送先のオリジンで読んではいけない");
    assert.match(away.message, /Away/); // 「サインインしていない」（読み取りエラーではない）

    await inPanel(`window.mxdeck.invoke("sign-in", "guest")`);
    await sleep(1500);
    assert.equal(await cookiesIn("guest"), 1);

    // サインイン済みの表示と、サインアウト（mxdeck の保存領域を消す）
    const st = await inPanel(`window.mxdeck.invoke("status")`);
    assert.deepEqual(st.local, { signedIn: true, accounts: [] });
    assert.deepEqual(st["local-js"], { signedIn: true, accounts: ["page user"] });
    assert.deepEqual(st.guest, { signedIn: false, accounts: [] }, "guest_id だけではサインインしていない");
    const out = await inPanel(`window.mxdeck.invoke("sign-out", "local")`);
    assert.equal(out.ok, true);
    assert.equal(await cookiesIn("local"), 0);
    assert.deepEqual((await inPanel(`window.mxdeck.invoke("status")`)).local, { signedIn: false, accounts: [] });
    assert.equal((await inPanel(`window.mxdeck.invoke("get", "local")`)).ok, false);
    // ほかのサービスには触れない
    assert.equal((await inPanel(`window.mxdeck.invoke("status")`))["local-js"].signedIn, true);

    // 「閉じる」ボタンでパネルが閉じる
    await inPanel(`document.getElementById("close").click()`);
    await sleep(500);
    const panels = await main.evaluate(
      `${E}.BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().endsWith("panel/panel.html")).length`,
    );
    assert.equal(panels, 0, "閉じるボタンで閉じていない");

    // パネルに渡ったものに、伏せていない値は無い
    const seen = JSON.stringify([got, gotJs]);
    for (const secret of [SESSION, CSRF, TOKEN]) assert.ok(!seen.includes(secret), secret);
  } finally {
    main.close();
    child.kill("SIGKILL");
    server.close();
    server.closeAllConnections();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
