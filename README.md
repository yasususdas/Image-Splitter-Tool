# 画像分割ツール

画像をブラウザ内だけで上下または左右に分割し、PNG として ZIP ダウンロードできる React / Vite 製のウェブツールです。

## ローカル起動

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

`dist/` が公開用ファイルです。

## 公開しやすい方法

### 0. GitHub Pages

このリポジトリには GitHub Pages 用の Actions デプロイ設定が入っています。

1. GitHub に新しい公開リポジトリを作成
2. このフォルダをそのリポジトリへ push
3. GitHub の `Settings` → `Pages` を開く
4. `Source` を `GitHub Actions` にする
5. `main` ブランチへ push すると自動で公開される

### 1. Vercel

1. GitHub にこのフォルダを push
2. Vercel にログイン
3. `New Project` から GitHub リポジトリを選択
4. Framework Preset は `Vite`
5. `Deploy` を押す

### 2. Netlify

1. GitHub にこのフォルダを push
2. Netlify の `Add new site` からリポジトリを選択
3. Build command: `npm run build`
4. Publish directory: `dist`

### 3. Cloudflare Pages

1. GitHub にこのフォルダを push
2. Cloudflare Pages でリポジトリを接続
3. Build command: `npm run build`
4. Build output directory: `dist`

## 特徴

- 画像はサーバーに送信されず、ブラウザ内だけで処理されます
- 上下分割 / 左右分割の両方に対応
- `n` 等分と `n%` 位置での 2 分割に対応
- 出力は PNG 固定、まとめて ZIP ダウンロード
