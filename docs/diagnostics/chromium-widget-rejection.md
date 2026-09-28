# Chromium Widget rejection の調査（2026-09-20）

## 症状

Windows / Electron 43.1.1 で、操作していない間も次の標準エラーログが出る。ユーザー報告では画面は正常。

```text
Message 2 rejected by interface blink.mojom.Widget
```

## 確認したこと

- 通知の起動時取得テストで3回中2回発生。3回とも通知取得は成功した。
- 取得用WebViewを12回作成・破棄する隔離テストでも再現した。
- 再利用、画面外への配置、visibility:hiddenの各条件でも発生することがあり、単独では解消しなかった。
- SocialDeckのコード・認証情報・通信を一切使わない最小Electronアプリでも、40回のWebView読み込みがすべて成功する間に6回発生した。発生回数は実行ごとに変わる。

この条件ではログと処理失敗は結び付いていない。SocialDeck固有のコードがなくても発生するが、Chromium内部でメッセージを拒否する正確な理由と、実環境でのすべての発生条件は未特定。ログだけから一律に無害とは判断しない。

## 再現

プロジェクトルートのPowerShellで実行する。

```powershell
.\node_modules\.bin\electron.cmd .\scripts\diagnostics\widget-rejection.cjs
```

一時プロファイルと非表示ウィンドウを使う。正常終了時は `Completed reads: 40` と表示する。ネイティブ標準エラーに上記ログが出るか確認する。タイムアウト・JS実行失敗と、Widgetログの発生は別の判定である。確率的な診断なので通常のCIには組み込まない。

アプリ本体の動作やログレベルは変更していない。今後Electronの更新候補を評価するときは、この再現と通知・表示のE2Eを比較する。

Chromiumのログ出力箇所は、内部メッセージの受け入れ失敗を記録している：
[InterfaceEndpointClient](https://github.com/chromium/chromium/blob/main/mojo/public/cpp/bindings/lib/interface_endpoint_client.cc)。
