// サービス定義の読み込みと検査。定義の書き方は README の「Service definitions」。
//
// 定義は 2 通り:
//   - JSON: Cookie と localStorage を読み、command のひな形に埋めるだけのもの。コードは持てない
//   - JS:   ページの中で関数を動かす（read.page）か、値からコマンドを組み立てる（build）もの
// 読み取った Cookie と localStorage の値は、書き手が列挙しなくても全部伏せる。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const expandHome = (p) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

// https のみ。http は手元のテスト用に 127.0.0.1 / localhost だけ
function checkUrl(value, what) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${what}: URL ではありません: ${value}`);
  }
  const local = u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname);
  if (u.protocol !== "https:" && !local) throw new Error(`${what}: https の URL にしてください: ${value}`);
  return u.toString();
}

function isText(v) {
  return typeof v === "string" || (v && typeof v === "object" && Object.values(v).every((s) => typeof s === "string"));
}

function validate(def, { allowCode }) {
  if (!def || typeof def !== "object") throw new Error("定義がオブジェクトではありません");
  if (!ID_RE.test(def.id ?? "")) throw new Error(`id は英小文字・数字・- で 40 字まで: ${def.id}`);
  if (typeof def.name !== "string" || !def.name) throw new Error("name がありません");
  if (def.bridge !== undefined && typeof def.bridge !== "string") throw new Error("bridge は文字列で");
  if (def.note !== undefined && !isText(def.note)) throw new Error("note は文字列か { en, ja }");
  const signInUrl = checkUrl(def.signInUrl, "signInUrl");

  const read = def.read ?? {};
  const keys = new Set();
  const addKey = (k) => {
    if (!KEY_RE.test(k)) throw new Error(`キー名は英数字と _ で: ${k}`);
    if (keys.has(k)) throw new Error(`キー名が重複しています: ${k}`);
    keys.add(k);
  };

  const cookies = {};
  for (const [k, c] of Object.entries(read.cookies ?? {})) {
    addKey(k);
    if (typeof c?.name !== "string" || !c.name) throw new Error(`read.cookies.${k}.name がありません`);
    cookies[k] = { url: checkUrl(c.url, `read.cookies.${k}.url`), name: c.name };
  }

  let localStorage = null;
  if (read.localStorage) {
    const ls = read.localStorage;
    localStorage = { url: checkUrl(ls.url ?? signInUrl, "read.localStorage.url"), keys: {} };
    for (const [k, storageKey] of Object.entries(ls.keys ?? {})) {
      addKey(k);
      if (typeof storageKey !== "string" || !storageKey) throw new Error(`read.localStorage.keys.${k} は文字列で`);
      localStorage.keys[k] = storageKey;
    }
  }

  let page = null;
  if (read.page) {
    if (!allowCode) throw new Error("read.page は JS の定義でだけ使えます");
    if (typeof read.page.run !== "function") throw new Error("read.page.run は関数で");
    page = { url: checkUrl(read.page.url ?? signInUrl, "read.page.url"), run: read.page.run };
  }

  if (!keys.size && !page) throw new Error("read に読むものがありません");

  if (def.describe !== undefined) {
    if (!allowCode) throw new Error("describe は JS の定義でだけ使えます");
    if (typeof def.describe !== "function") throw new Error("describe は関数で");
  }

  if (def.build !== undefined) {
    if (!allowCode) throw new Error("build は JS の定義でだけ使えます");
    if (typeof def.build !== "function") throw new Error("build は関数で");
    if (def.command !== undefined) throw new Error("command と build はどちらか一方だけ");
  } else {
    if (typeof def.command !== "string" || !def.command) throw new Error("command（または JS の build）がありません");
    for (const [, k] of def.command.matchAll(PLACEHOLDER_RE)) {
      if (!keys.has(k)) throw new Error(`command の {${k}} は read に無いキーです`);
    }
  }

  return {
    id: def.id,
    name: def.name,
    bridge: def.bridge ?? "",
    note: def.note ?? null,
    signInUrl,
    read: { cookies, localStorage, page },
    command: def.command ?? null,
    build: def.build ?? null,
    describe: def.describe ?? null,
  };
}

function loadFile(file) {
  const abs = path.resolve(expandHome(file));
  if (abs.endsWith(".json")) {
    return validate(JSON.parse(fs.readFileSync(abs, "utf8")), { allowCode: false });
  }
  if (abs.endsWith(".js") || abs.endsWith(".cjs")) {
    delete require.cache[abs];
    return validate(require(abs), { allowCode: true });
  }
  throw new Error("定義は .json か .js");
}

// 内蔵の定義（services/）と、設定で足された定義を読む。壊れた定義は飛ばして errors に入れる。
// 同じ id があれば後から読んだほう（設定側）が勝つ
function loadAll({ builtinDir, extra = [] }) {
  const files = [
    ...fs
      .readdirSync(builtinDir)
      .filter((f) => /\.(js|json)$/.test(f))
      .sort()
      .map((f) => path.join(builtinDir, f)),
    ...extra,
  ];
  const byId = new Map();
  const errors = [];
  for (const f of files) {
    try {
      const def = loadFile(f);
      byId.set(def.id, def);
    } catch (err) {
      errors.push({ file: String(f), message: String(err.message ?? err) });
    }
  }
  return { services: [...byId.values()], errors };
}

module.exports = { validate, loadFile, loadAll, PLACEHOLDER_RE };
