// Slack（mautrix-slack）
//
// mautrix-slack の "token" ログインは 2 つの値をこの順で受け取る:
//   auth_token    xoxc-... トークン。ワークスペースごとに localStorage.localConfig_v2 にある
//   cookie_token  slack.com の "d" Cookie（HttpOnly）
// `login token <auth_token> <cookie_token>` で一度に送れる。Cookie の値はブリッジ側で URL デコードするので、そのまま渡す。
//
// localStorage は app.slack.com のオリジンのものなので、そのオリジンの軽いページ（robots.txt）で読む。
// Slack のアプリ本体を読み込まずに済む。

// localConfig_v2 のワークスペースのうち、ブラウザ用のトークン（xoxc-）を持つもの
function workspacesIn(config) {
  let teams = [];
  try {
    teams = Object.values(JSON.parse(config ?? "{}").teams ?? {});
  } catch {
    teams = [];
  }
  return teams
    .filter((t) => t && typeof t.token === "string" && t.token.startsWith("xoxc-"))
    .map((t) => ({ name: t.name || t.domain || t.id, domain: t.domain || "", token: t.token }));
}

const titleOf = (ws) => (ws.domain ? `${ws.name} (${ws.domain})` : ws.name);

module.exports = {
  id: "slack",
  name: "Slack",
  bridge: "mautrix-slack",
  signInUrl: "https://slack.com/signin",
  // サインイン前のページも b などの Cookie を置くので、"d" があるかで見る
  signedInWhen: ["d"],
  read: {
    localStorage: { url: "https://app.slack.com/robots.txt", keys: { config: "localConfig_v2" } },
    cookies: { d: { url: "https://slack.com", name: "d" } },
  },
  build({ localStorage, cookies }, { UserError }) {
    const workspaces = workspacesIn(localStorage.config);
    if (!workspaces.length) throw new UserError("slack_noToken");
    if (!cookies.d) throw new UserError("slack_noCookie");
    return workspaces.map((ws) => ({ title: titleOf(ws), text: `login token ${ws.token} ${cookies.d}`, secrets: [ws.token] }));
  },
  // サインイン中のワークスペース（名前とドメインだけ。トークンは出さない）
  describe: ({ localStorage, cookies }) => (cookies.d ? workspacesIn(localStorage.config).map(titleOf) : []),
  note: {
    en:
      "Sign in, and when Slack offers the desktop app, choose to use Slack in the browser so the workspace opens. " +
      "Send the command to the mautrix-slack bot in your management room; elsewhere add the prefix (e.g. `!slack login token ...`). " +
      "Signing out of Slack in this window also signs the bridge out.",
    ja:
      "サインインし、デスクトップアプリを勧められたら「ブラウザで使う」を選んでワークスペースを開いてください。" +
      "コマンドは mautrix-slack の bot との管理ルームに送ります。それ以外のルームでは接頭辞を付けます（例: 「!slack login token ...」）。" +
      "このウィンドウで Slack からサインアウトすると、ブリッジもサインアウトされます。",
  },
};
