// 定義に従って値を読み、コマンドを組み立てる。読み方（reader）は外から渡すので、Electron なしで試せる。
//
//   reader.cookie(url, name)          → string | null
//   reader.localStorage(url, keys[])  → { [storageKey]: string | null } | null（そのオリジンで開けなかったら null）
//   reader.page(url, fn)              → fn の戻り値 | null

const { PLACEHOLDER_RE } = require("./definitions");
const { maskSecrets } = require("./mask");

// 利用者が直せる問題（サインインしていない等）。message はメッセージのキーか { en, ja }
class UserError extends Error {
  constructor(message, detail) {
    super(typeof message === "string" ? message : (message?.en ?? "error"));
    this.userMessage = message;
    this.detail = detail;
  }
}

async function collect(def, reader) {
  const values = { cookies: {}, localStorage: {}, page: null };
  for (const [k, c] of Object.entries(def.read.cookies)) {
    values.cookies[k] = (await reader.cookie(c.url, c.name)) || null;
  }
  const ls = def.read.localStorage;
  if (ls && Object.keys(ls.keys).length) {
    const got = (await reader.localStorage(ls.url, Object.values(ls.keys))) ?? {};
    for (const [k, storageKey] of Object.entries(ls.keys)) values.localStorage[k] = got[storageKey] || null;
  }
  if (def.read.page) values.page = await reader.page(def.read.page.url, def.read.page.run);
  return values;
}

// → [{ title, text, secrets }]。secrets には、読んだ Cookie と localStorage の値が必ず入る
function commands(def, values) {
  const flat = { ...values.cookies, ...values.localStorage };
  const auto = Object.values(flat).filter((v) => typeof v === "string" && v);

  if (def.command) {
    const missing = [...def.command.matchAll(PLACEHOLDER_RE)].map(([, k]) => k).filter((k) => !flat[k]);
    if (missing.length) throw new UserError("notSignedIn", { missing });
    const text = def.command.replace(PLACEHOLDER_RE, (_m, k) => flat[k]);
    return [{ title: def.name, text, secrets: auto }];
  }

  const out = def.build(values, { UserError });
  if (!Array.isArray(out) || !out.length) throw new UserError("nothingBuilt");
  return out.map((r) => {
    if (typeof r?.text !== "string" || !r.text) throw new Error("build の結果に text がありません");
    return { title: r.title || def.name, text: r.text, secrets: [...(r.secrets ?? []), ...auto] };
  });
}

// サインインしているか。cookies はその保存領域の Cookie 全部（[{ name, value }]）。
// signedInWhen があれば、その名前の Cookie が全部あるとき。無ければ Cookie が 1 つでもあるとき。
// ただし signedInWhen の無い定義では、これは「していない」を早く決めるためだけに使い、
// 「している」は buildable で確かめる（サインイン前から Cookie を置くサービスが多いので）
function signedIn(def, cookies) {
  if (!def.signedInWhen) return cookies.length > 0;
  const present = new Set(cookies.filter((c) => c.value).map((c) => c.name));
  return def.signedInWhen.every((name) => present.has(name));
}

// 読んだ値でコマンドが組み立てられるか（「取得」が通るか）。signedInWhen の無い定義のサインインの判定に使う。
// UserError（サインインしていない等）だけが「組み立てられない」。定義の誤りは「取得」で見せるので true
function buildable(def, values) {
  try {
    commands(def, values);
    return true;
  } catch (err) {
    return !(err instanceof UserError);
  }
}

// どこに（誰として）サインインしているか。画面に出すので、読んだ値そのものは伏せる
function describe(def, values) {
  if (!def.describe) return [];
  let labels;
  try {
    labels = def.describe(values);
  } catch {
    return [];
  }
  if (!Array.isArray(labels)) return [];
  const secrets = Object.values({ ...values.cookies, ...values.localStorage }).filter((v) => typeof v === "string" && v);
  return labels
    .filter((l) => typeof l === "string" && l)
    .map((l) => maskSecrets(l, secrets))
    .slice(0, 20);
}

module.exports = { UserError, buildable, collect, commands, describe, signedIn };
