# Wave Logger Mapper

Radio Wave Logger で出力したCSVログデータをインタラクティブな地図上に可視化するWebアプリ。

## セットアップ

```bash
npm install
npm run dev
```

## デプロイ

```bash
npx vercel
```

## 機能

- CSVファイルのドラッグ&ドロップアップロード
- 下り速度 / 上り速度 / Ping でのカラー表示切替
- 計測ポイントのCircleMarker + 軌跡のPolyline表示
- ポップアップで各ポイントの詳細情報を表示
- カラースケール凡例

## Python CLI (参考)

```bash
pip install -r requirements.txt
python tools/visualize_map.py <CSVファイル> [--metric download_mbps]
```
