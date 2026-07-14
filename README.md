# SocialDeck 🦜

TweetDeck風のマルチカラムSNSクライアント。  
**X (Twitter)** を WebView でそのまま表示、**Bluesky** は AT Protocol API でリアルタイム取得。

---

## ✨ 機能

| 機能 | X (Twitter) | Bluesky |
|------|:-----------:|:-------:|
| タイムライン表示 | ✅ WebView | ✅ API |
| 通知 | ✅ WebView | ✅ API |
| 統合通知センター | ✅ アカウント別導線 | ✅ 絞り込み・未読管理 |
| 検索 | ✅ WebView | ✅ API |
| リスト | ✅ WebView | — |
| いいね・RT | ✅ (WebView内) | ✅ API |
| 返信・投稿 | ✅ (WebView内) | ✅ API |
| X / Bluesky 同時投稿 | ✅ | ✅ |
| 投稿プレビュー・画像ALT | ✅ 同時投稿ALT | ✅ |
| カスタムフィード | — | ✅ Discover等 |
| 画像表示 | ✅ | ✅ |
| 引用ポスト | — | ✅ |
| マルチカラム | ✅ | ✅ |
| ページネーション | — | ✅ |
| localStorage永続化 | ✅ | ✅ |

---

## 🚀 セットアップ

### 必要なもの
- [Node.js](https://nodejs.org/) v18以上
- npm

### インストール・起動

```bash
# このフォルダに移動
cd socialdeck

# 依存パッケージをインストール
npm install

# 起動
npm start

# 開発モード（DevTools付き）
npm run dev
```

### ビルド（配布用）

```bash
# Windows インストーラー (.exe)
npm run build-win

# Mac (.dmg)
npm run build-mac

# Linux (.AppImage)
npm run build-linux
```

ビルド成果物は `dist/` フォルダに生成されます。

---

## 📖 使い方

### ログイン

1. 起動するとログイン画面が表示されます
2. **X タブ**: 表示名（@username）を入力して「X カラムを追加」
   - X は WebView 表示のため、初回はブラウザと同様に X.com でログインしてください
3. **Bluesky タブ**: ハンドルとアプリパスワードを入力
   - アプリパスワード: [bsky.app/settings/app-passwords](https://bsky.app/settings/app-passwords) で発行
4. 「開く →」でアプリを起動

### カラム操作

- **追加**: 左サイドバーの「＋」またはトップバー「カラム追加」
- **更新**: カラムヘッダーの更新ボタン、またはサイドバーの「↻」（全更新）
- **削除**: カラムヘッダーの「×」ボタン
- **もっと見る**: Bluesky カラムの最下部ボタン

### キーボードショートカット

| キー | 動作 |
|------|------|
| `Ctrl+N` | カラムを追加 |
| `Ctrl+R` | すべて更新 |
| `Ctrl+←` | 左にスクロール |
| `Ctrl+→` | 右にスクロール |
| `Esc` | モーダルを閉じる |

### 投稿

- サイドバーのX・Bluesky投稿ボタンから投稿モーダルを開けます
- 「Xにも投稿」「Blueskyにも投稿」を選ぶと両サービスへ同時投稿できます（返信を除く）
- 投稿プレビュー、画像ALT、`Ctrl+Enter`による送信に対応しています

---

## 🔐 セキュリティ

- Bluesky のアプリパスワードは `localStorage` に保存されます
- X のセッションは Electron の永続パーティション (`persist:x`) に保存されます
- アプリパスワードはブラウザ外に送信されることはありません

---

## 🛠️ 技術スタック

- **Electron** — デスクトップアプリ基盤
- **WebView2 (webview タグ)** — X.com をそのまま表示
- **Bluesky AT Protocol** — リアルタイムAPI
- **Vanilla JS / CSS** — フレームワークなし

---

## ⚠️ 注意事項

- X の表示は公式サイトをそのまま埋め込んでいます。X の仕様変更により動作しなくなる可能性があります
- 本アプリは個人利用を想定した非公式クライアントです
