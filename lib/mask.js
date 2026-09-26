// 値は画面に全体を出さない。先頭と末尾の 4 文字だけを見せ、伏せていないコマンドはクリップボードにだけ入れる。
// スクリーンショット・画面共有・肩越しに写らないようにするため（login-helper-for-mautrix と同じ）。

function mask(value) {
  if (value.length <= 12) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

// text の中の秘密をすべて伏せる。長いものから置き換えるので、別の秘密を含む秘密もまとめて伏せる
function maskSecrets(text, secrets) {
  let out = text;
  for (const s of [...new Set(secrets)].filter((s) => typeof s === "string" && s).sort((a, b) => b.length - a.length)) {
    out = out.split(s).join(mask(s));
  }
  return out;
}

module.exports = { mask, maskSecrets };
