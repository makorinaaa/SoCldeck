# コードの構成と変更先

## 起動と信頼境界

| 場所 | 担当 |
| --- | --- |
| `src/main.js` | Electron起動、ウィンドウ生成、モジュール生成とIPC登録 |
| `src/preload.js` | 許可したIPC操作とイベントだけを画面へ渡す |
| `src/main/electron-trust-policy.js` | IPC送信元、ナビゲーション、WebView設定の検証 |
| `src/main/bluesky-gateway.js` | 認証情報の選択、操作の検証、トークン更新とセッション競合 |
| `src/main/bluesky-atproto-client.js` | 固定接続先へのAPI通信、タイムアウト、応答解析 |
| `src/main/bluesky-session-vault.js` | OS暗号化を使ったトークン保存 |
| `src/main/x-video-file.js` | X用動画トリム、一時動画のサイズ・パス検査、読取と削除 |
| `src/main/bluesky-video-file.js` | Bluesky用動画検証・トリム・アップロード用データ作成 |
| `src/main/ffmpeg-runtime.js` | FFmpeg実行と共通の出力サイズ予算 |
| `src/main/x-timeline-tap.js` | 非表示XページへのDevTools Protocol接続、応答の読み取り、画像・動画の読み込み停止 |
| `src/main/x-timeline-normalizer.js` | XのGraphQL応答（タイムライン・ポスト詳細・投稿）を表示用データへ変換 |
| `src/main/x-notification-normalizer.js` | Xの通知データ（GraphQL・REST）を通知センター用データへ変換 |

動画ファイル処理はElectronやIPCを直接参照しません。
Mainは信頼済み送信元を確認してからモジュールを呼びます。
XとBlueskyで異なる形式・サイズ・時間制限は各モジュールで保持します。

## 画面

| 場所 | 担当 |
| --- | --- |
| `src/index.html` | 画面構造、CSP、スクリプトとスタイルの入口 |
| `src/styles/app.css` | 共通スタイルとテーマ変数 |
| `src/renderer.js` | 状態と各モジュールの接続、ユーザー操作の登録 |
| `src/renderer/icons.mjs` | 固定SVGアイコン |
| `src/renderer/app-shell-runtime.mjs` | ショートカット、メニュー、トースト、ホストイベントと購読解除 |
| `src/renderer/keyboard-navigation.mjs` | 1文字ショートカット（投稿・カラム間の移動、いいね／リポスト／返信、ヘルプ表示） |
| `src/renderer/network-adapters.js` | X / Bluesky等の機能・カラム定義 |
| `src/renderer/compose-*.js` | 共通の投稿画面、下書き、試行状態、同時投稿 |
| `src/renderer/x-composer-submit.mjs` | Xページ内への入力、添付の準備確認、送信 |
| `src/renderer/x-composer-dom.js` | Xの投稿欄と添付メディアの検出（投稿準備・投稿確認で共用） |
| `src/renderer/bsky-*.js` | Blueskyの投稿表示、カラム、プロフィール、リアクション等 |
| `src/renderer/x-native-timeline-runtime.js` | Xホーム（ネイティブ）：カラムの組み立て、新着バッジ、ログイン画面、クリックとポストの更新 |
| `src/renderer/x-native-readers.js` | アカウントごとの非表示ホームページ：読み込み、取得データの処理、更新、タブ切り替え、続きの読み込み |
| `src/renderer/x-native-posts.js` | ネイティブXのポスト一覧の並べ替え・統合・1ページ目との突き合わせ（DOMなし） |
| `src/renderer/x-native-page-scripts.js` | Xのホームページ内で動かすスクリプト（タブ、最新順、未読バッジ） |
| `src/renderer/x-native-column-view.js` | ネイティブXカラムの描画（HTMLの再利用、差分更新） |
| `src/renderer/x-native-detail.js` | ポスト詳細画面と会話の取得 |
| `src/renderer/x-native-reactions.js` | いいね・リポスト・削除とそのメニュー |
| `src/renderer/x-post-view.js` | ネイティブXのポストと会話のHTML |
| `src/renderer/x-status-*.js` | 操作用の非表示ポストページと、その中で動かすスクリプト |
| `src/renderer/x-notification-capture.js` | X通知データのアカウント別保持と取得元の決定 |
| `src/renderer/notification-*.js` | 通知の取得、表示、未読状態、会話表示 |
| `src/renderer/column-*.js` | カラムの生成・保存・並べ替え・削除取り消し |
| `src/renderer/workspace-*.js` | ワークスペースの保存、検証、バックアップ、復旧 |

詳しいカラム・バックアップ変更先は [Rendererの変更ガイド](renderer-maintenance.md) を参照。
既存モジュールは `legacy-runtime-modules.mjs` に互換入口があり、
新しいRendererモジュールは `.mjs` の名前付きエクスポートを使用します。
信頼境界や下書きの状態機械を、画面入口に複製しません。

## この整理で維持したこと

- CSSの内容・適用順、HTMLのID、保存キー、投稿・通知の状態モデル。
- X動画の形式・時間・サイズ上限、投稿用一時動画の読取・削除先を制限する検査。
- MainのIPC送信元検査、CSP、contextIsolation、sandbox。
- 自動更新の配布先とアプリのバージョン番号。

未使用の旧メニュー生成処理、状態キーの別名、投稿busyのラッパー、
先頭へスクロールする重複関数を削除しました。
Ctrl/Cmd+Enterは画面の投稿ボタンと同じ経路を使うようにし、
画面側の送信可否チェックを二重管理しません。

## 検証

- `npm run lint`：ESLint による未定義・未使用変数などの静的検査。
- `npm test`：機能の単体テスト、動画ファイル制限、購読解除、ショートカット。
- `npm run test:e2e`：隔離Electron環境で画面操作と保存・再読込を検証。
- `npm run test:security`：ローカル疑似サーバーで認証・応答・HTML・IPCを検証。
- `npm run security:check`：既知の秘密情報パターンの混入検査。

外部サービスの仕様に依存するXの画面操作は、実サービスでの動作保証とは区別します。
