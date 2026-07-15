# Release Checklist

SocialDeckのWindowsリリースは、次の手順で作成します。

## 1. リリース前確認

- `package.json` とAbout画面のバージョンが一致する
- XとBlueskyへログインできる
- タイムライン、通知センター、投稿、同時投稿を手動確認する
- 投稿失敗時に本文と添付が保持され、再試行できる
- `npm audit --omit=dev` の結果を確認する
- `npm run release:check` が成功する

## 2. インストーラー作成

```powershell
npm ci
npm run release:win
```

成果物は `dist/SocialDeck-<version>-x64.exe` に生成されます。

## 3. 成果物確認

- インストーラーとインストール後の実行ファイルにSocialDeckアイコンが表示される
- 新規インストールと上書きインストールの両方で起動できる
- 「アプリ > SocialDeckについて」に正しいバージョンが表示される
- Windows Defenderで成果物をスキャンする
- 別のWindowsユーザー環境で起動確認する

## 4. 公開

- リリースノートに主な変更、既知の問題、データ移行の有無を書く
- インストーラーのSHA-256を併記する
- 対応するGitタグを作成する

署名されていないインストーラーはWindows SmartScreenの警告対象になります。一般公開する場合はコード署名証明書を設定してください。
