# セキュリティ対策

SocialDeck は X と Bluesky に接続する Electron デスクトップクライアントです。
独自の多人数向け API サーバーや SQL データベースはありません。

## 実装している境界

| 項目 | 対策と適用範囲 |
| --- | --- |
| SQL インジェクション | 現状は SQL を実行しないため該当する入口なし。将来 DB を導入する際は値をプレースホルダーで渡し、列名・ソート順は許可リストで検証する。 |
| XSS | アカウント情報と投稿本文を HTML エスケープ。投稿の外部リンクは HTTP(S) のみ許可し、資格情報入り URL は拒否。別タブリンクに `noopener noreferrer` を付与。CSP、contextIsolation、sandbox、WebView の Node.js 無効化も維持する。 |
| 認証・権限 | アプリ IPC はリクエストごとに送信元フレームとローカル画面の URL を検証。Bluesky の操作は Main 側の Vault にある認証情報を使用し、書き込み先 DID を画面から受け取らない。いいね・リポスト・フォローの解除では URI の所有者とコレクションを検証する。 |
| セッション競合 | ログアウト・アカウント変更後は古い非同期処理の結果を返さず、古い更新処理による認証情報の再保存を拒否。更新レスポンスの DID が変わった場合も拒否する。送信済みのリモート操作自体を取り消すものではない。 |
| 秘密情報 | Bluesky のトークンを Electron safeStorage で暗号化し、暗号化不能・`basic_text` バックエンドでは保存を拒否する。一般画面への返却は公開アカウント情報に限定する。 |
| Cookie | X はアカウント別の永続セッションで分離。認証 Cookie の値をアプリ画面へ返さず、認証の有無だけを返す。WebView の接続先は HTTPS に限定。Bluesky API 通信は `credentials: omit`、`redirect: error` に固定する。 |

X の認証 Cookie の `Secure` / `HttpOnly` / `SameSite` は X 側が発行時に設定します。
アプリ側で一律に書き換えると WebView 内ログインや CSRF 対策を壊すため、変更していません。
アプリが設定する `night_mode` は非機密の表示設定で、`Secure` と `SameSite=None` を使用します。
公開プロフィールや公開投稿を別ユーザーの DID で読むことは正常な機能です。
リモート上の最終的な認可は X / Bluesky のサーバーが担当します。

## API キーを追加する場合

- API キー、パスワード、トークンをソース・テスト・ログ・バックアップへ直接書かない。
- 開発用の値は環境変数などから Main 側で取得する。`.env` は Git 管理しない。
- 配布アプリへ共通の秘密キーを埋め込まない。環境変数をビルド時に置換して同梱する方法も不可。共通キーが必要なら認証・認可を備えたサーバー側で保持する。
- 利用者固有の長期資格情報を保存する場合は OS の暗号化ストレージを利用する。
- 流出時はファイル削除だけで済ませず、発行元で失効・再発行する。

`npm run security:check` は作業ツリーの Git 管理対象と未追跡・非無視ファイルに対し、
既知の API キー形式・秘密鍵ヘッダー・一部のキー直書き・管理対象 `.env` を検出します。
CI でも実行し、検出時は値を出さずファイル名・行番号・ルール名だけを報告します。
全形式の秘密情報や Git 履歴を検査するものではありません。

## 確認

`npm test` は危険なリンク、HTML 注入、他人のレコード URI、ログアウト中の更新、
暗号化フォールバック、既知のキー形式の検出を含みます。
`npm run test:e2e` は Electron 上の操作回帰を確認します。
実サービスを相手にした侵入テストや、すべての依存ライブラリの脆弱性監査ではありません。

参考: [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)、
[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)、
[OWASP IDOR Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)。
