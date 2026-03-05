"""
Network Quality Logger - Google Map可視化スクリプト
CSVログデータをインタラクティブなGoogle Map上に描画する

使い方:
    python visualize_map.py <CSVファイルパス> [--output output.html] [--metric download_mbps]

必要なパッケージ:
    pip install folium pandas

出力:
    HTMLファイル（ブラウザで開いてインタラクティブに操作可能）
"""

import argparse
import sys
from pathlib import Path

try:
    import folium
    import pandas as pd
    from folium.plugins import HeatMap
except ImportError:
    print("必要なパッケージをインストールしてください:")
    print("  pip install folium pandas")
    sys.exit(1)


def get_color(value: float, metric: str) -> str:
    """速度値に応じたカラーコードを返す (赤=遅い, 緑=速い)"""
    if metric in ("download_mbps", "upload_mbps"):
        if value >= 50:
            return "#22c55e"  # 緑 (優秀)
        elif value >= 20:
            return "#84cc16"  # 黄緑 (良好)
        elif value >= 10:
            return "#eab308"  # 黄色 (普通)
        elif value >= 5:
            return "#f97316"  # オレンジ (やや遅い)
        else:
            return "#ef4444"  # 赤 (遅い)
    elif metric == "ping_ms":
        # Pingは低いほど良い
        if value <= 20:
            return "#22c55e"
        elif value <= 50:
            return "#84cc16"
        elif value <= 100:
            return "#eab308"
        elif value <= 200:
            return "#f97316"
        else:
            return "#ef4444"
    return "#6b7280"


def create_map(csv_path: str, output_path: str, metric: str) -> None:
    """CSVからインタラクティブマップを生成する"""
    # CSV読み込み
    df = pd.read_csv(csv_path, encoding="utf-8-sig")

    # 必須カラムチェック
    required = ["latitude", "longitude", metric]
    missing = [c for c in required if c not in df.columns]
    if missing:
        print(f"エラー: 必須カラムが見つかりません: {missing}")
        print(f"利用可能なカラム: {list(df.columns)}")
        sys.exit(1)

    # 無効な行を除去
    df = df.dropna(subset=["latitude", "longitude", metric])

    if df.empty:
        print("エラー: 有効なデータ行がありません")
        sys.exit(1)

    # 地図の中心点を計算
    center_lat = df["latitude"].mean()
    center_lng = df["longitude"].mean()

    # 地図を作成
    m = folium.Map(
        location=[center_lat, center_lng],
        zoom_start=14,
        tiles="OpenStreetMap",
    )

    # 凡例の追加
    metric_label = {
        "download_mbps": "下り速度 (Mbps)",
        "upload_mbps": "上り速度 (Mbps)",
        "ping_ms": "Ping (ms)",
    }.get(metric, metric)

    legend_html = f"""
    <div style="position: fixed; bottom: 30px; left: 30px; z-index: 1000;
                background: white; padding: 12px 16px; border-radius: 8px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2); font-family: sans-serif;">
        <h4 style="margin: 0 0 8px 0; font-size: 14px;">{metric_label}</h4>
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 12px;">
            <span><span style="color: #22c55e;">●</span> 優秀</span>
            <span><span style="color: #84cc16;">●</span> 良好</span>
            <span><span style="color: #eab308;">●</span> 普通</span>
            <span><span style="color: #f97316;">●</span> やや遅い</span>
            <span><span style="color: #ef4444;">●</span> 遅い</span>
        </div>
        <p style="margin: 8px 0 0 0; font-size: 11px; color: #666;">
            計測ポイント: {len(df)}件
        </p>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))

    # 各計測ポイントをマーカーとして追加
    for _, row in df.iterrows():
        value = row[metric]
        color = get_color(value, metric)

        # ポップアップ内容
        popup_parts = [f"<b>日時:</b> {row.get('timestamp', 'N/A')}"]
        popup_parts.append(f"<b>DL:</b> {row.get('download_mbps', 'N/A')} Mbps")
        popup_parts.append(f"<b>UL:</b> {row.get('upload_mbps', 'N/A')} Mbps")
        popup_parts.append(f"<b>Ping:</b> {row.get('ping_ms', 'N/A')} ms")
        popup_parts.append(f"<b>接続:</b> {row.get('connection_type', 'N/A')}")

        if pd.notna(row.get("cellular_gen")):
            popup_parts.append(f"<b>世代:</b> {row['cellular_gen']}")
        if pd.notna(row.get("carrier")):
            popup_parts.append(f"<b>キャリア:</b> {row['carrier']}")
        if pd.notna(row.get("signal_dbm")):
            popup_parts.append(f"<b>電波:</b> {row['signal_dbm']} dBm")
        if pd.notna(row.get("memo")) and row["memo"]:
            popup_parts.append(f"<b>メモ:</b> {row['memo']}")

        popup_html = "<br>".join(popup_parts)

        folium.CircleMarker(
            location=[row["latitude"], row["longitude"]],
            radius=10,
            color=color,
            fill=True,
            fill_color=color,
            fill_opacity=0.7,
            popup=folium.Popup(popup_html, max_width=300),
            tooltip=f"{metric_label}: {value}",
        ).add_to(m)

    # 軌跡の線を追加
    if len(df) > 1:
        coordinates = df[["latitude", "longitude"]].values.tolist()
        folium.PolyLine(
            coordinates,
            weight=2,
            color="#6b7280",
            opacity=0.5,
            dash_array="5 10",
        ).add_to(m)

    # HTMLファイルとして保存
    m.save(output_path)
    print(f"マップを生成しました: {output_path}")
    print(f"  計測ポイント数: {len(df)}")
    print(f"  表示指標: {metric_label}")


def main():
    parser = argparse.ArgumentParser(
        description="Network Quality Logger - CSV → Google Map 可視化"
    )
    parser.add_argument("csv_file", help="CSVログファイルのパス")
    parser.add_argument(
        "--output", "-o", default=None, help="出力HTMLファイルパス (デフォルト: 入力ファイル名.html)"
    )
    parser.add_argument(
        "--metric",
        "-m",
        default="download_mbps",
        choices=["download_mbps", "upload_mbps", "ping_ms"],
        help="表示する指標 (デフォルト: download_mbps)",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv_file)
    if not csv_path.exists():
        print(f"エラー: ファイルが見つかりません: {csv_path}")
        sys.exit(1)

    output_path = args.output or str(csv_path.with_suffix(".html"))

    create_map(str(csv_path), output_path, args.metric)


if __name__ == "__main__":
    main()
