# Renderer の変更ガイド

`src/renderer.js` は各モジュールの生成、依存の受け渡し、ユーザー操作と保存処理の接続を行います。機能の内部状態や DOM 操作は、該当する `src/renderer/` のモジュールに置きます。

画面の静的なスタイルは `src/styles/app.css`、共通アイコンは `src/renderer/icons.mjs` に置きます。
HTMLは構造、CSSは表示、Rendererの入口はモジュール間の接続を担当します。
画面全体のキーボード・アプリメニュー・トースト・Mainからのイベントは
`app-shell-runtime.mjs` が管理します。`attach()` / `dispose()` でリスナーとタイマーを管理し、
ショートカットとクリックは同じ操作を実行します。Ctrl/Cmd+Enter は有効な投稿ボタンをクリックします。
preload のイベント購読は解除関数を返します。

## カラム操作を拡張する場合

| 変更したいこと | 主な変更先 |
| --- | --- |
| カラムの種類・ネットワーク固有の動作 | `src/renderer/network-adapters.js` |
| 追加画面 | `src/renderer/column-picker.js` |
| ヘッダー・メニュー・幅・折りたたみ | `src/renderer/column-shell-runtime.js` |
| ドラッグによる並べ替え | `src/renderer/column-reorder-runtime.js` |
| 保存・復元・削除時の連携 | `src/renderer/column-lifecycle.js` |
| 保存形式とレイアウトの取得 | `src/renderer/column-runtime.js` |
| 添付ファイルのドラッグ保護 | `src/renderer/file-drag-shield.js` |
| 直前のカラム削除の取り消し | `src/renderer/column-undo.js` |
| バックアップ形式・検証・アカウント照合・復元 | `src/renderer/workspace-backup.js` |
| バックアップ設定画面 | `src/renderer/backup-settings-runtime.js` |
| 状態・レイアウトの直前の正常値と破損復旧 | `src/renderer/workspace-storage.js` |
| 投稿メニューとクリップボード操作 | `src/renderer/post-menu-runtime.mjs` |
| アプリ情報・更新状況の表示 | `src/renderer/app-info-runtime.mjs` |
| Xリスト追加ダイアログ | `src/renderer/x-list-dialog-runtime.mjs` |
| X投稿欄への入力・添付完了の確認 | `src/renderer/x-composer-submit.mjs` |

並べ替えモジュールは、指定したコンテナ内のカラムに限定して DOM の順序とドラッグの一時状態を管理します。`attach()` で開始し、`dispose()` でリスナーと表示状態を片付けます。どちらも重複呼び出しが可能です。

順序が変わったときだけ `onReorder()` を呼び、呼び出し側が通知と保存を行います。保存には実際の DOM 順序を使用します。`isDragging()` はファイルのドラッグ保護との連携用です。モジュール内から localStorage や通知表示を直接操作しません。

外部からのドラッグ、ヘッダー内のボタン操作、移動せず終了したドラッグでは順序を保存しません。終了時には移動先の強調表示と一時的な要素を除去し、遅れて実行される描画処理も終了済みのドラッグを変更しません。

## 確認

- `npm test`：既存モジュールのユニットテスト。
- `node --test --test-name-pattern="column reorder" tests-e2e/notification-operations.e2e.test.js`：左右への移動、再読み込み後の復元、外部ドラッグ、キャンセル、終了処理を Electron 上で確認。
- `npm run test:e2e`：アプリ全体の操作テスト。

Renderer の入口は `src/index.html` の単一の `type="module"` スクリプトです。新しいモジュールは `.mjs` に名前付きの `export` を定義し、利用側から `import` します。HTMLで読み込み順を管理しません。

既存の `window.SocialDeck...` 形式のモジュールは `legacy-runtime-modules.mjs` に互換処理を集約しています。`renderer.js` はそこから名前付きで取り込みます。この互換処理は段階的な移行用で、既存モジュール内部には従来の公開形式が残っています。新しい機能ではグローバル公開を増やさず、既存モジュールを移行するときは互換処理から該当項目を取り除きます。

画面の振る舞いはモジュールテストとElectron E2Eで検証します。関数名やソース文字列、スクリプトの列挙順をテストに固定しません。E2Eは実際のボタン操作を優先し、状態の注入が必要な統合検証だけ入口の名前付きエクスポートを使用します。起動・操作中の未処理エラーも失敗として扱います。

X投稿は本文の反映、投稿欄内の添付数（動画ではプレビュー）、処理中表示の消失、送信ボタンの有効化を確認してから送信します。120秒以内に確認できなければ送信しません。投稿欄外のタイムライン画像は数えません。XのDOMは外部仕様のため、セレクター変更時には `x-composer-submit.test.js` とElectronの投稿欄テストの両方を確認してください。

## バックアップを拡張する場合

バックアップは `format: socialdeck-workspace`、`version: 1` の JSON です。保存可能な項目を明示的に列挙し、未知のプロパティは取り込みません。新しい設定を対象に加えるときは、書き出し・検証・書き込み・復元直前の退避の四つを合わせて更新してください。認証情報や下書き、通知の既読履歴は含めません。

ファイル操作は `src/main/workspace-backup-files.js` が担当し、信頼済み Renderer の IPC からネイティブダイアログで選択したファイルだけを読み書きします。書き出しは一時ファイルから置き換えます。復元内容の確認と保存形式の検証は Renderer が担当します。

`workspace-storage.js` の対象は `socialdeck_v4` と `socialdeck_cols` です。`.last-good` に直前の正常値、`.corrupt` に読み込めなかった元データを保持します。明示的な空レイアウトと保存データの不在は、破損として扱いません。Bluesky のトークンは正常値の退避コピーから除外します。

削除取り消しは実行中のアプリ内で直前の1件だけを保持します。保存・DOM 復元・アカウント照合は呼び出し側から渡し、復元に失敗した場合は再試行用の情報を残します。
