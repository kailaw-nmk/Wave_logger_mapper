# Wave Logger Mapper

## プロジェクト概要
Radio Wave Logger アプリで計測した通信品質CSVデータを、インタラクティブな地図上に可視化するWebアプリケーション。
CSVファイルをアップロードすると、Leaflet地図上に計測ポイントがカラーマップで表示される。

姉妹プロジェクト: [Radio_wave_logger](https://github.com/kailaw-nmk/Radio_wave_logger) (計測アプリ本体)

## 技術スタック
- **フレームワーク**: Next.js 15 (App Router)
- **言語**: TypeScript (strict mode)
- **地図**: Leaflet + react-leaflet
- **CSV解析**: PapaParse
- **デプロイ先**: Vercel

## ディレクトリ構成
```
Wave_logger_mapper/
├── CLAUDE.md              # このファイル
├── .claude/               # Claude Code設定
│   ├── settings.json
│   └── commands/          # カスタムコマンド
├── app/                   # Next.js App Router ページ
│   ├── layout.tsx         # ルートレイアウト
│   ├── page.tsx           # メイン画面 (CSV Upload + Map)
│   ├── not-found.tsx      # 404ページ
│   └── globals.css        # グローバルスタイル
├── src/
│   ├── components/
│   │   ├── CsvUploader.tsx  # CSVファイルアップロードUI
│   │   ├── MapView.tsx      # Leaflet地図表示
│   │   └── Legend.tsx       # カラースケール凡例
│   └── lib/
│       ├── csvParser.ts     # CSV解析ロジック
│       └── colorScale.ts    # メトリクス別カラースケール
├── next.config.ts
├── tsconfig.json
└── package.json
```

## コーディング規約

### 全般
- すべてのファイルはTypeScriptで記述する（.ts / .tsx）
- `any` 型の使用禁止。必ず適切な型を定義する
- コメントは日本語で記述する
- エラーメッセージは日本語で表示する（ユーザー向けUI）

### Next.js 固有
- App Router を使用（`pages/` ディレクトリは使用しない）
- Leaflet等ブラウザ専用ライブラリは `dynamic(() => import(...), { ssr: false })` でSSR無効化
- `'use client'` ディレクティブはクライアントコンポーネントにのみ付与
- パスエイリアス `@/*` → `./src/*` を使用

### CSV仕様（Radio Wave Logger側の出力形式）
- エンコーディング: UTF-8 (BOM付き)
- 改行コード: CRLF
- カラム: timestamp, latitude, longitude, accuracy, download_mbps, upload_mbps, ping_ms, connection_type, cellular_gen, carrier, signal_dbm, memo

## 開発コマンド
```bash
npm run dev      # 開発サーバー起動
npm run build    # プロダクションビルド
npm run start    # プロダクションサーバー起動
npm run lint     # ESLint実行
```

## 既知の課題
- 空の `pages/` ディレクトリが存在するとビルドエラーになる（要削除）

## デプロイ
- Vercel にデプロイ予定
- `next build` が成功することを確認してからデプロイする
- Leaflet の CSS は CDN または node_modules から読み込み
