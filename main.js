// mxdeck プラグイン本体。メニューからパネルを開き、サービスごとに
//   サインイン … 専用の保存領域（ctx.sites）のウィンドウで、そのサービスにサインインする
//   取得       … その保存領域の Cookie と localStorage を読み、ブリッジのログインコマンドを組み立てる
// 伏せていないコマンドは main から出さない。パネルに渡すのは伏せた文字列と参照番号だけで、
// コピーは main が clipboard に書く。

const { BrowserWindow, clipboard } = require("electron");
const path = require("node:path");
const { loadAll } = require("./lib/definitions");
const { createHash } = require("node:crypto");
const { UserError, collect, commands, describe, signedIn } = require("./lib/run");
const { maskSecrets } = require("./lib/mask");
const { forLocale } = require("./lib/messages");

const CLIPBOARD_TTL_MS = 60_000;
const LOAD_TIMEOUT_MS = 30_000;

exports.activate = (ctx) => {
  const i18n = forLocale(ctx.locale);
  const { t } = i18n;
  const extra = Array.isArray(ctx.config.services) ? ctx.config.services.map(String) : [];
  let loaded = loadAll({ builtinDir: path.join(__dirname, "services"), extra });

  // パネルを開くたびに読み直す（外部の定義ファイルを直したら、再起動せずに反映される）
  const reload = () => (loaded = loadAll({ builtinDir: path.join(__dirname, "services"), extra }));
  const find = (id) => loaded.services.find((s) => s.id === id);

  // ---- 読み取り（Electron）
  // localStorage とページの中身は、そのオリジンのページを画面に出さずに開いて読む。
  // リダイレクトで別のオリジンに着いたら（サインインしていない等）、読まずに null
  async function inPage(ses, url, code) {
    const w = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
    try {
      let timer;
      const timeout = new Promise((_r, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout: ${url}`)), LOAD_TIMEOUT_MS);
      });
      // リダイレクトで読み込みが中断されても（ERR_ABORTED）、着いた先を見て判断する
      await Promise.race([w.loadURL(url).catch(() => {}), timeout]).finally(() => clearTimeout(timer));
      if (new URL(w.webContents.getURL()).origin !== new URL(url).origin) return null;
      const json = await w.webContents.executeJavaScriptInIsolatedWorld(1000, [{ code }]);
      return json == null ? null : JSON.parse(json);
    } finally {
      w.destroy();
    }
  }

  const readerFor = (def) => {
    const ses = ctx.sites.session(def.id);
    return {
      cookie: async (url, name) => (await ses.cookies.get({ url, name }))[0]?.value ?? null,
      localStorage: (url, keys) =>
        inPage(ses, url, `JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((k) => [k, localStorage.getItem(k)])))`),
      page: (url, fn) => inPage(ses, url, `(async () => JSON.stringify(await (${fn.toString()})()))()`),
    };
  };

  // ---- パネル
  let refs = new Map(); // 参照番号 -> 伏せていないコマンド（パネルを閉じるまで、または取り直すまで）
  let nextRef = 1;

  // サインインしているか。定義の signedInWhen の Cookie が揃っていれば（無ければ Cookie が 1 つでもあれば）「している」。
  // 定義に describe があれば、どこに（誰として）サインインしているかも添える。
  // describe は値を読む（localStorage なら画面に出さずにページを開く）ので、Cookie が変わったときだけ読み直す
  const described = new Map(); // id -> { key, accounts }
  async function status(def) {
    const cookies = await ctx.sites.session(def.id).cookies.get({});
    if (!signedIn(def, cookies)) return { signedIn: false, accounts: [] };
    if (!def.describe) return { signedIn: true, accounts: [] };
    const key = createHash("sha256")
      .update(cookies.map((c) => `${c.domain} ${c.name}=${c.value}`).sort().join("\n"))
      .digest("hex");
    const cached = described.get(def.id);
    if (cached?.key === key) return { signedIn: true, accounts: cached.accounts };
    let accounts = [];
    try {
      accounts = describe(def, await collect(def, readerFor(def)));
    } catch {
      accounts = [];
    }
    described.set(def.id, { key, accounts });
    return { signedIn: true, accounts };
  }
  const statuses = async () =>
    Object.fromEntries(await Promise.all(loaded.services.map(async (s) => [s.id, await status(s)])));

  ctx.panel.handle("init", async () => {
    reload();
    refs = new Map();
    described.clear();
    const status = await statuses();
    return {
      lang: i18n.lang,
      dict: i18n.dict,
      services: loaded.services.map((s) => ({
        id: s.id,
        name: s.name,
        bridge: s.bridge ? t("forBridge", { bridge: s.bridge }) : "",
        note: i18n.text(s.note),
        status: status[s.id],
        signOutConfirm: t("signOutConfirm", { service: s.name }),
      })),
      errors: loaded.errors,
    };
  });

  // パネルがフォーカスを取り戻したとき（サインイン用のウィンドウから戻ったとき）に表示を直す
  ctx.panel.handle("status", statuses);

  // mxdeck に保存したサインイン情報を消す。サービス側のセッションは無効にしないので、
  // ブリッジに渡したコマンドはそのまま使える（ブリッジも止めたいなら、サービスの中でサインアウトする）
  ctx.panel.handle("sign-out", async (id) => {
    const def = find(id);
    if (!def) return { ok: false };
    ctx.sites.close?.(def.id);
    const ses = ctx.sites.session(def.id);
    await ses.clearStorageData();
    await ses.clearCache();
    for (const [ref, v] of refs) if (v.service === id) refs.delete(ref);
    described.delete(id);
    return { ok: true, message: t("signedOut", { service: def.name }) };
  });

  ctx.panel.handle("sign-in", (id) => {
    const def = find(id);
    if (def) ctx.sites.open(def.id, def.signInUrl);
  });

  ctx.panel.handle("get", async (id) => {
    const def = find(id);
    if (!def) return { ok: false, message: t("errorGeneric", { error: `unknown service ${id}` }) };
    for (const [ref, v] of refs) if (v.service === id) refs.delete(ref);
    try {
      const results = commands(def, await collect(def, readerFor(def)));
      // 取れたらサインイン用のウィンドウはもう要らない。閉じてもサインインは保存領域に残る
      // （sites.close の無い古い mxdeck では閉じずにおく）
      const closed = ctx.sites.close?.(def.id) > 0;
      return {
        ok: true,
        message: closed ? `${t("ok")} ${t("closedWindows", { service: def.name })}` : t("ok"),
        results: results.map((r) => {
          const ref = nextRef++;
          refs.set(ref, { service: id, text: r.text });
          return { ref, title: r.title, masked: maskSecrets(r.text, r.secrets) };
        }),
      };
    } catch (err) {
      if (err instanceof UserError) {
        const m = err.userMessage;
        return { ok: false, message: typeof m === "string" ? t(m, { service: def.name }) : i18n.text(m, { service: def.name }) };
      }
      return { ok: false, message: t("errorGeneric", { error: String(err.message ?? err) }) };
    }
  });

  ctx.panel.handle("copy", (ref) => {
    const entry = refs.get(ref);
    if (!entry) return false;
    clipboard.writeText(entry.text);
    // まだ同じ内容が入っていれば消す（その後に別のものをコピーしていたら触らない）
    setTimeout(() => {
      if (clipboard.readText() === entry.text) clipboard.clear();
    }, CLIPBOARD_TTL_MS);
    return true;
  });

  ctx.menu.add({
    label: t("menu"),
    click: () => ctx.panel.open({ file: path.join(__dirname, "panel", "panel.html"), width: 480, height: 560, resizable: true }),
  });
};
