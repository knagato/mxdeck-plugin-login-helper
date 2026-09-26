// 定義の検査・コマンドの組み立て・伏せ字。Electron なしで動く。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validate, loadAll } = require("../lib/definitions");
const { collect, commands, UserError } = require("../lib/run");
const { maskSecrets } = require("../lib/mask");
const { forLocale } = require("../lib/messages");
const slack = require("../services/slack");

const root = path.resolve(import.meta.dirname, "..");
const example = JSON.parse(fs.readFileSync(path.join(root, "examples/cookie-login.json"), "utf8"));

const fakeReader = ({ cookies = {}, storage = {}, page = null } = {}) => ({
  cookie: async (url, name) => cookies[`${new URL(url).origin} ${name}`] ?? null,
  localStorage: async (_url, keys) => Object.fromEntries(keys.map((k) => [k, storage[k] ?? null])),
  page: async () => page,
});

test("JSON definition: fills the command and masks every value it read", async () => {
  const def = validate(example, { allowCode: false });
  const values = await collect(
    def,
    fakeReader({
      cookies: {
        "https://example.com session": "sess-0123456789abcdef",
        "https://example.com csrf_token": "csrf-fedcba9876543210",
      },
    }),
  );
  const [r] = commands(def, values);
  assert.equal(r.text, "login sess-0123456789abcdef csrf-fedcba9876543210");
  assert.equal(maskSecrets(r.text, r.secrets), "login sess***cdef csrf***3210");
});

test("JSON definition: a missing value is 'not signed in', never a half-filled command", async () => {
  const def = validate(example, { allowCode: false });
  const values = await collect(def, fakeReader({ cookies: { "https://example.com session": "x".repeat(20) } }));
  assert.throws(() => commands(def, values), (e) => e instanceof UserError && e.userMessage === "notSignedIn");
});

test("JSON definitions cannot carry code", () => {
  assert.throws(() => validate({ ...example, command: undefined, build: () => [] }, { allowCode: false }), /JS/);
  assert.throws(
    () => validate({ ...example, read: { page: { run: () => 1 } } }, { allowCode: false }),
    /JS/,
  );
});

test("validation", () => {
  const bad = (patch, re) => assert.throws(() => validate({ ...example, ...patch }, { allowCode: true }), re);
  bad({ id: "Bad Id" }, /id/);
  bad({ signInUrl: "http://example.com/" }, /https/);
  bad({ command: "login {nope}" }, /nope/);
  bad({ read: {} }, /読むもの/);
  bad(
    { read: { cookies: { a: { url: "https://example.com", name: "a" } }, localStorage: { keys: { a: "k" } } } },
    /重複/,
  );
  // テスト用に http://127.0.0.1 は通す
  assert.ok(validate({ ...example, signInUrl: "http://127.0.0.1:1234/" }, { allowCode: false }));
});

test("loadAll: built-ins plus extra files; broken ones are reported, not fatal; extra wins on the same id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-"));
  const good = path.join(dir, "good.json");
  const broken = path.join(dir, "broken.json");
  const override = path.join(dir, "slack.json");
  fs.writeFileSync(good, JSON.stringify(example));
  fs.writeFileSync(broken, "{");
  fs.writeFileSync(override, JSON.stringify({ ...example, id: "slack", name: "Slack (mine)" }));
  const { services, errors } = loadAll({ builtinDir: path.join(root, "services"), extra: [good, broken, override] });
  assert.deepEqual(services.map((s) => s.id).sort(), ["example", "slack"]);
  assert.equal(services.find((s) => s.id === "slack").name, "Slack (mine)");
  assert.equal(errors.length, 1);
  assert.match(errors[0].file, /broken/);
});

test("Slack: one command per workspace, token and d cookie masked", async () => {
  const def = validate(slack, { allowCode: true });
  const token = "xoxc-1111111111-2222222222-abcdef";
  const d = "xoxd-AAAAAAAAAAAAAAAA%2FBBBB";
  const config = JSON.stringify({
    teams: {
      T1: { id: "T1", name: "Team One", domain: "one", token },
      T2: { id: "T2", name: "Legacy", domain: "old", token: "xoxs-not-a-client-token" },
    },
  });
  const values = await collect(
    def,
    fakeReader({ storage: { localConfig_v2: config }, cookies: { "https://slack.com d": d } }),
  );
  const results = commands(def, values);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Team One (one)");
  assert.equal(results[0].text, `login token ${token} ${d}`);
  assert.equal(maskSecrets(results[0].text, results[0].secrets), "login token xoxc***cdef xoxd***BBBB");
});

test("Slack: not signed in", async () => {
  const def = validate(slack, { allowCode: true });
  const noToken = await collect(def, fakeReader());
  assert.throws(() => commands(def, noToken), (e) => e.userMessage === "slack_noToken");
  const config = JSON.stringify({ teams: { T: { name: "T", token: "xoxc-123456789012345" } } });
  const noCookie = await collect(def, fakeReader({ storage: { localConfig_v2: config } }));
  assert.throws(() => commands(def, noCookie), (e) => e.userMessage === "slack_noCookie");
});

test("messages: every key exists in both languages, including the built-in services' errors", () => {
  const en = forLocale("en-US").dict;
  const ja = forLocale("ja").dict;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ja).sort());
  for (const k of ["slack_noToken", "slack_noCookie", "notSignedIn", "nothingBuilt"]) assert.ok(en[k] && ja[k], k);
  assert.equal(forLocale("ja-JP").t("notSignedIn", { service: "X" }).includes("X"), true);
});
