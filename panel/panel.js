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

function renderService(s) {
  const card = el("section", "service");
  const header = el("header");
  header.append(el("h2", "", s.name), el("span", "bridge", s.bridge));
  const signIn = el("button", "", dict.signIn);
  const get = el("button", "", dict.get);
  const out = el("div");
  signIn.addEventListener("click", () => window.mxdeck.invoke("sign-in", s.id));
  get.addEventListener("click", async () => {
    get.disabled = true;
    out.replaceChildren(el("p", "status", dict.reading));
    try {
      renderResults(out, await window.mxdeck.invoke("get", s.id));
    } finally {
      get.disabled = false;
    }
  });
  const buttons = el("div", "buttons");
  buttons.append(signIn, get);
  card.append(header);
  if (s.note) card.append(el("p", "note", s.note));
  card.append(buttons, out);
  return card;
}

(async () => {
  const init = await window.mxdeck.invoke("init");
  dict = init.dict;
  document.documentElement.lang = init.lang;
  $("title").textContent = dict.title;
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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.mxdeck.close();
});
