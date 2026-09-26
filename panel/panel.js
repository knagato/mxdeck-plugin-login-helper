// パネルは伏せた文字列と参照番号しか受け取らない。コピーは main が行う。
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

let dict = {};

function renderResults(box, res) {
  box.replaceChildren();
  const status = el("p", `status ${res.ok ? "ok" : "warn"}`, res.message);
  box.append(status);
  for (const r of res.results ?? []) {
    const div = el("div", "result");
    const button = el("button", "", dict.copy);
    const note = el("span", "warn");
    button.addEventListener("click", async () => {
      const ok = await window.mxdeck.invoke("copy", r.ref);
      button.textContent = ok ? dict.copied : dict.copy;
      note.textContent = ok ? "" : ` ${dict.copyFailed}`;
    });
    div.append(el("b", "", r.title), el("div", "cmd", r.masked), button, note);
    box.append(div);
  }
}

const cards = new Map(); // id -> setStatus({ signedIn, accounts })

function renderService(s) {
  const card = el("section", "service");
  const header = el("header");
  const badge = el("span", "badge");
  header.append(el("h2", "", s.name), el("span", "bridge", s.bridge), badge);
  const signIn = el("button", "", dict.signIn);
  const get = el("button", "", dict.get);
  const signOut = el("button", "", dict.signOut);
  const accounts = el("p", "accounts");
  const out = el("div");
  const setStatus = ({ signedIn, accounts: list }) => {
    badge.textContent = signedIn ? dict.signedIn : dict.notSignedInBadge;
    badge.classList.toggle("on", signedIn);
    signOut.hidden = !signedIn;
    accounts.hidden = !(signedIn && list.length);
    accounts.textContent = dict.signedInAs.replace("{accounts}", list.join(", "));
  };
  setStatus(s.status);
  cards.set(s.id, setStatus);
  signIn.addEventListener("click", () => window.mxdeck.invoke("sign-in", s.id));
  // 消す前に、何が消えて何が残るかを見せる（ブリッジは止まらない）
  signOut.addEventListener("click", () => {
    const box = el("div", "confirm");
    const yes = el("button", "", dict.signOutDo);
    const no = el("button", "", dict.cancel);
    const row = el("div", "buttons");
    row.append(yes, no);
    box.append(el("p", "", s.signOutConfirm), row);
    out.replaceChildren(box);
    no.addEventListener("click", () => out.replaceChildren());
    yes.addEventListener("click", async () => {
      const res = await window.mxdeck.invoke("sign-out", s.id);
      out.replaceChildren(el("p", `status ${res.ok ? "ok" : "warn"}`, res.message ?? ""));
      setStatus({ signedIn: false, accounts: [] });
    });
  });
  get.addEventListener("click", async () => {
    get.disabled = true;
    out.replaceChildren(el("p", "status", dict.reading));
    try {
      renderResults(out, await window.mxdeck.invoke("get", s.id));
      setStatus((await window.mxdeck.invoke("status"))[s.id]);
    } finally {
      get.disabled = false;
    }
  });
  const buttons = el("div", "buttons");
  buttons.append(signIn, get, signOut);
  card.append(header, accounts);
  if (s.note) card.append(el("p", "note", s.note));
  card.append(buttons, out);
  return card;
}

(async () => {
  const init = await window.mxdeck.invoke("init");
  dict = init.dict;
  document.documentElement.lang = init.lang;
  $("title").textContent = dict.title;
  $("close").textContent = dict.close;
  $("close").title = `${dict.close} (Esc)`;
  $("close").addEventListener("click", () => window.mxdeck.close());
  for (const k of ["maskedNote", "storageNote", "safetyNote"]) $(k).textContent = dict[k];
  if (init.errors.length) {
    $("errors").hidden = false;
    $("errors").append(el("p", "", dict.loadErrors));
    for (const e of init.errors) $("errors").append(el("p", "", `${e.file}: ${e.message}`));
  }
  const list = $("services");
  if (!init.services.length) list.append(el("p", "", dict.none));
  for (const s of init.services) list.append(renderService(s));
})();

// サインイン用のウィンドウから戻ってきたら、サインインの表示を直す
window.addEventListener("focus", async () => {
  const status = await window.mxdeck.invoke("status");
  for (const [id, st] of Object.entries(status)) cards.get(id)?.(st);
});

// Esc と ⌘W では mxdeck がパネルを閉じる
