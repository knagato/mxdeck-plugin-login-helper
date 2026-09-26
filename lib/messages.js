// 画面の文言（英語・日本語）。定義側の文言（note や UserError の { en, ja }）も同じ言語で選ぶ。

const MESSAGES = {
  en: {
    menu: "Bridge login commands…",
    title: "Login Helper",
    close: "Close",
    forBridge: "for {bridge}",
    signIn: "Sign in",
    get: "Get login command",
    reading: "Reading…",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Could not copy.",
    ok: "Copy the command and send it to the bridge bot.",
    closedWindows: "The {service} window was closed; you stay signed in.",
    signedIn: "Signed in",
    signedInAs: "Signed in to: {accounts}",
    notSignedInBadge: "Not signed in",
    signOut: "Sign out…",
    signOutConfirm:
      "This deletes the {service} sign-in saved in mxdeck (cookies and site data). Commands you already sent to the bridge keep working, because the session on {service} stays valid. To stop the bridge too, first press “Sign in” and sign out inside {service}.",
    signOutDo: "Delete sign-in",
    cancel: "Cancel",
    signedOut: "Deleted the {service} sign-in from mxdeck.",
    notSignedIn: "Not signed in. Press “Sign in”, sign in to {service} in that window, then try again.",
    nothingBuilt: "Nothing was found to build a command from.",
    slack_noToken:
      "No Slack token found. Press “Sign in”, sign in, and open your workspace in the browser (not the desktop app), then try again.",
    slack_noCookie: "Could not read the “d” cookie. Sign in to Slack in the sign-in window, then try again.",
    errorGeneric: "Error: {error}",
    maskedNote:
      "Only the first and last 4 characters of each value are shown. “Copy” puts the full command on the clipboard and clears it after 60 seconds.",
    safetyNote:
      "Nothing is sent anywhere. The command gives full access to your account — never paste it anywhere except your own bridge bot.",
    storageNote: "Each service signs in with its own storage inside mxdeck, separate from your Matrix accounts and your browser.",
    loadErrors: "Some service definitions could not be loaded:",
    none: "No services.",
  },
  ja: {
    menu: "ブリッジのログインコマンド…",
    title: "ログインヘルパー",
    close: "閉じる",
    forBridge: "{bridge} 用",
    signIn: "サインイン",
    get: "ログインコマンドを取得",
    reading: "読み取り中…",
    copy: "コピー",
    copied: "コピーしました",
    copyFailed: "コピーできませんでした。",
    ok: "コマンドをコピーして、ブリッジの bot に送ってください。",
    closedWindows: "{service} のウィンドウは閉じました（サインインは残っています）。",
    signedIn: "サインイン済み",
    signedInAs: "サインイン中: {accounts}",
    notSignedInBadge: "未サインイン",
    signOut: "サインアウト…",
    signOutConfirm:
      "mxdeck に保存した {service} のサインイン情報（Cookie とサイトのデータ）を消します。{service} 側のセッションは残るので、ブリッジに送ったコマンドは引き続き使えます。ブリッジも止めたいときは、先に「サインイン」で開いたウィンドウの中で {service} からサインアウトしてください。",
    signOutDo: "サインイン情報を消す",
    cancel: "キャンセル",
    signedOut: "mxdeck から {service} のサインイン情報を消しました。",
    notSignedIn: "サインインしていないようです。「サインイン」を押し、開いたウィンドウで {service} にサインインしてから、もう一度試してください。",
    nothingBuilt: "コマンドを組み立てる材料が見つかりませんでした。",
    slack_noToken:
      "Slack のトークンが見つかりませんでした。「サインイン」からサインインし、ワークスペースを（デスクトップアプリではなく）ブラウザで開いてから、もう一度試してください。",
    slack_noCookie: "「d」Cookie を読み取れませんでした。サインイン用のウィンドウで Slack にサインインしてから、もう一度試してください。",
    errorGeneric: "エラー: {error}",
    maskedNote:
      "画面には各値の先頭と末尾の 4 文字だけを表示しています。「コピー」を押すと伏せていないコマンドがクリップボードに入り、60 秒後に消えます。",
    safetyNote:
      "外部には何も送信しません。コマンドはアカウントそのものと同じ権限を持つので、自分のブリッジ bot 以外には絶対に貼り付けないでください。",
    storageNote: "サービスごとに mxdeck 内の専用の保存領域でサインインします。Matrix のアカウントやブラウザとは別です。",
    loadErrors: "読み込めなかったサービス定義があります:",
    none: "サービスがありません。",
  },
};

function forLocale(locale) {
  const lang = String(locale ?? "").toLowerCase().startsWith("ja") ? "ja" : "en";
  const dict = MESSAGES[lang];
  const fill = (s, subs = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in subs ? String(subs[k]) : m));
  return {
    lang,
    dict,
    t: (key, subs) => fill(dict[key] ?? MESSAGES.en[key] ?? key, subs),
    // 定義が持つ文言: 文字列はそのまま、{ en, ja } はこの言語（無ければ英語）
    text: (v, subs) => (v == null ? "" : fill(typeof v === "string" ? v : (v[lang] ?? v.en ?? ""), subs)),
  };
}

module.exports = { forLocale, MESSAGES };
