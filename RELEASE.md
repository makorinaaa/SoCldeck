# Release Checklist

## Automatic updates

Installed builds check GitHub Releases shortly after launch and every four hours. When an update finishes downloading, the About dialog offers to restart and apply it.

To publish a Windows update:

1. Update the version in `package.json` and `package-lock.json`.
2. Commit the release changes.
3. Create and push a matching tag such as `v2.1.2`.
4. GitHub Actions publishes the installer, blockmap, and `latest.yml` to a public GitHub Release.

The release workflow validates that the tag matches `package.json`, runs unit and Electron E2E tests as separate steps, and stores their logs in the `test-results-<attempt>` artifact for 14 days. Electron E2E tests retry once after a failure; a retry that succeeds is reported as a workflow warning and keeps both attempt logs for diagnosis.

Do not upload `latest.yml` separately from its installer. They must come from the same build. Draft releases are not visible to installed applications.

Version 2.1.2 is the first complete auto-update capable build, so it must be installed manually once. Later releases can update it automatically.

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
