# mxdeck-plugin-login-helper

[日本語](#日本語)

A plugin for [mxdeck](https://github.com/knagato/mxdeck) that signs in to a service in its own window
and builds the login command for that service's Matrix bridge. Tokens are never shown in full: the
panel shows only their first and last 4 characters, and the full command goes only to the clipboard
(cleared after 60 seconds). **Nothing is sent anywhere.**

It does the same job as the Chrome extension
[Login Helper for mautrix bridges](https://github.com/knagato/login-helper-for-mautrix), without a browser:
each service gets its own storage inside mxdeck, separate from your Matrix accounts and from your browser.
And it is not limited to mautrix — any bridge whose login takes values from cookies or local storage can be
added with a small [service definition](#service-definitions), without touching this plugin.

## Built-in services

| Service | Bridge | Command it builds |
|---|---|---|
| Slack | [mautrix-slack](https://github.com/mautrix/slack) | `login token <xoxc token> <d cookie>` (one per signed-in workspace) |

## Install

```bash
git clone https://github.com/knagato/mxdeck-plugin-login-helper.git
```

In mxdeck: プラグイン (Plugins) → プラグインを追加… (Add plugin…), pick the folder, and restart.
No `npm install` is needed; the plugin has no dependencies.

## Usage

1. プラグイン → **Bridge login commands…**
2. **Sign in** opens the service in a window with the service's own storage. Sign in there.
   For Slack, when it offers the desktop app, choose to use Slack in the browser so the workspace opens.
3. **Get login command**, then **Copy** the one you want and send it to your bridge bot in its management room
   (elsewhere, add the bridge's command prefix, e.g. `!slack login token ...`).

The sign-in stays in mxdeck. Signing out of the service in that window also signs the bridge out,
because the bridge uses the same session.

## Service definitions

Add your own services with files listed in the plugin's `config` in mxdeck's `plugins.json`:

```json
{
  "plugins": [
    {
      "path": "~/src/mxdeck-plugin-login-helper",
      "config": { "services": ["~/bridges/example.json"] }
    }
  ]
}
```

The panel re-reads the files each time it opens. A definition with the same `id` as a built-in one replaces it.

### JSON: cookies and local storage into a command

```json
{
  "id": "example",
  "name": "Example service",
  "bridge": "example-bridge",
  "signInUrl": "https://example.com/login",
  "signedInWhen": ["session"],
  "read": {
    "cookies": {
      "session": { "url": "https://example.com", "name": "session" },
      "csrf": { "url": "https://example.com", "name": "csrf_token" }
    },
    "localStorage": { "url": "https://app.example.com/", "keys": { "token": "auth_token" } }
  },
  "command": "login {session} {csrf} {token}",
  "note": { "en": "Send it to the bridge bot.", "ja": "ブリッジ bot に送ってください。" }
}
```

| Field | |
|---|---|
| `id` | Lowercase letters, digits, `-`. Names the service's storage (`persist:plugin-login-helper-<id>`), so keep it stable |
| `signInUrl` | Opened by **Sign in**. `https` only (`http://127.0.0.1` / `localhost` for testing) |
| `signedInWhen` | Names of cookies that exist only after signing in (e.g. `["auth_token"]` for X). The panel shows “Signed in” when all of them are in the service's storage. Without it, any cookie counts, which is wrong for services that set cookies before sign-in |
| `read.cookies` | `key: { url, name }`. HttpOnly cookies are readable |
| `read.localStorage` | Read by loading `url` (default `signInUrl`) out of sight. If it redirects to another origin, nothing is read. A light page on that origin (such as `/robots.txt`) avoids running the whole app |
| `command` | `{key}` is replaced with the value read under that key. If any is missing, the panel says the user is not signed in |
| `note` | A string, or `{ en, ja }` |

**Every value read is masked**, without listing it anywhere. JSON definitions cannot contain code.

### JS: when a command needs logic

A `.js` file exporting the same shape, with `build` instead of `command`, and optionally `read.page`
(a function run inside the page, returning JSON-serialisable data). See [`services/slack.js`](services/slack.js).

```js
module.exports = {
  id: "example-js",
  name: "Example",
  signInUrl: "https://example.com/login",
  read: {
    cookies: { session: { url: "https://example.com", name: "session" } },
    page: { url: "https://example.com/", run: () => document.querySelector("meta[name=user]")?.content },
  },
  build({ cookies, localStorage, page }, { UserError }) {
    if (!cookies.session) throw new UserError({ en: "Not signed in.", ja: "サインインしていません。" });
    return [{ title: page, text: `login ${cookies.session}`, secrets: [] }];
  },
};
```

`secrets` lists values that did not come from `cookies` / `localStorage` (those are masked anyway) — for example
a token found inside a JSON string. Anything not covered would be shown in full.

`describe(values)` (optional) returns labels for **where** the user is signed in — workspace names, a user name —
shown next to “Signed in” so people can tell which account the command would be for. Return only what is safe to
show; anything equal to a value read from cookies or local storage is masked anyway. The built-in Slack definition
lists the signed-in workspaces this way. JSON definitions show only “Signed in”.

JS definitions run inside mxdeck with its full rights, like the plugin itself. Only use files you trust.

## Development

```bash
pnpm test    # unit tests, plus a run inside mxdeck if ../mxdeck exists (MXDECK_DIR to point elsewhere)
```

The mxdeck test starts mxdeck on a temporary profile with local servers standing in for services.
It does not touch the clipboard.

## Disclaimer

Not affiliated with, endorsed by, or sponsored by Slack Technologies or the mautrix project.
Using your own session token may be restricted by the service's terms. Use at your own risk.

## License

[MIT](LICENSE)

---

## 日本語

[mxdeck](https://github.com/knagato/mxdeck) のプラグイン。サービスに専用のウィンドウでサインインし、
その Matrix ブリッジに送るログインコマンドを組み立てます。トークンは画面に全体を表示しません。
先頭と末尾の 4 文字だけを出し、伏せていないコマンドはクリップボードにだけ入れます（60 秒後に消えます）。
**外部には何も送信しません。**

Chrome 拡張 [Login Helper for mautrix bridges](https://github.com/knagato/login-helper-for-mautrix) と同じ役目を、
ブラウザなしで果たします。サインインはサービスごとに mxdeck 内の専用の保存領域で行い、Matrix のアカウントやブラウザとは混ざりません。
mautrix に限らず、Cookie や localStorage の値でログインするブリッジなら、[サービス定義](#service-definitions)を書くだけで足せます。

### 使い方

1. mxdeck の「プラグイン → プラグインを追加…」でこのフォルダを選び、再起動する
2. 「プラグイン → ブリッジのログインコマンド…」
3. 「サインイン」で開いたウィンドウでサインインする。Slack はデスクトップアプリを勧められたら「ブラウザで使う」を選ぶ
4. 「ログインコマンドを取得」→ 使うものを「コピー」して、ブリッジ bot との管理ルームに送る
   （それ以外のルームでは `!slack login token ...` のように接頭辞を付ける）

このウィンドウでサービスからサインアウトすると、同じセッションを使っているブリッジもサインアウトされます。

### サービスを足す

`plugins.json` のこのプラグインの `config.services` に定義ファイルのパスを並べます（書き方は上の
[Service definitions](#service-definitions)）。Cookie と localStorage を読んでひな形に埋めるだけなら JSON で書け、
コードは要りません。読んだ値は列挙しなくても全部伏せます。
`signedInWhen` にサインイン後にだけ置かれる Cookie の名前を並べると（X なら `["auth_token"]`）、それが全部そろったときだけ「サインイン済み」と出します。
書かなければ Cookie が 1 つでもあれば「サインイン済み」とみなすので、サインイン前から Cookie を置くサービスでは書いてください。処理が要るときは JS で書きます（mxdeck と同じ権限で動くので、信頼できるものだけ）。
JS の定義では `describe` で「どこに（誰として）サインインしているか」を返せ、パネルの「サインイン済み」の横に出ます（Slack はワークスペース名）。
