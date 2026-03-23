# 画像分割ツール

画像をブラウザ内だけで上下または左右に分割し、PNG として ZIP ダウンロードできる React / Vite 製のウェブツールです。

## 公開サイト

[https://image-splitter-tool-sand.vercel.app/](https://image-splitter-tool-sand.vercel.app/)

ブラウザ上だけで画像を処理するため、アップロードした画像がサーバーに送信されることはありません。

## できること

- 画像を上下または左右に分割
- `n` 等分での分割
- `n%` の位置を指定した 2 分割
- 分割後の画像を PNG でまとめて ZIP ダウンロード

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

## 公開方法

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
