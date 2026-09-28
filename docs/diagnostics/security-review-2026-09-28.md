# 追加セキュリティ確認（2026-09-28）

## 検出と対応

1. **保存済みレイアウトの HTML 注入（修正済み）**
   `widget-mode-runtime.js` の option 要素へ id/title/sub を未エスケープで挿入していた。
   バックアップ取り込みでも文字列を保存できるため、悪意あるタイトルで select を閉じ、別要素を挿入できた。
   既存 CSP によるスクリプト抑止はあるが、表示改変は防げない。全項目をエスケープし、悪意ある文字列の回帰テストを追加した。

2. **セキュリティヘッダーの削除（修正済み）**
   Main 起動処理が defaultSession の X-Frame-Options / X-Content-Type-Options と
   persist:x の X-Frame-Options を削除していた。サーバー側の防御を弱めるため削除処理を撤去した。
   実際の攻撃成功を確認したものではない。実サイトのログインを伴う手動確認は未実施。

3. **IPC 送信元の追加制限（防御強化）**
   既存のローカル画面 URL・トップフレーム検査に加え、Main/Widget の実際の WebContents であることを毎回確認する。
   同じファイルを開いた別 WebContents は拒否する。Linux 等のファイルパス比較は大文字・小文字を区別するよう修正。
   この検査は信頼済み画面内の XSS そのものを防ぐものではない。

4. **依存パッケージの既知脆弱性（更新済み）**
   npm audit は High 6 パッケージを報告した。互換範囲内の更新で 12 インストール項目を更新し、監査結果は 0 件となった。
   対象は @xmldom/xmldom、brace-expansion、fast-uri、js-yaml、tar、undici。
   js-yaml / undici は本番依存にも含まれ、残りは開発依存。報告された全攻撃経路がこのアプリから到達可能と確認したわけではない。
   更新は package-lock.json に保存。インストール時の追加スクリプトは実行していない。

## 確認範囲と制限

- Main / preload の IPC、外部 URL、WebView 設定、FFmpeg 起動、一時ファイル、バックアップ I/O、アカウント・ウィジェット表示を確認。
- FFmpeg は引数配列と shell:false を使用。一般ファイル読み取り IPC は一時動画のパス・拡張子・サイズを検査。これらについて今回新たな外部入力からの攻撃成立は確認していない。
- 秘密情報の既知パターン検査は 0 件。Git 履歴は未検査。
- 単体・Electron E2E はローカルのフィクスチャを使用。実アカウントへの侵入テスト、署名付き配布物の検証、FFmpeg バイナリや Electron 内蔵コンポーネントの全面監査は対象外。
- npm audit の 0 件は、現在のレジストリ情報とロックファイルについての結果であり、未知の脆弱性がないことを保証しない。

IPC 検査の参考: [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages)。
