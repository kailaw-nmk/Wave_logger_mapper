import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wave Logger Mapper',
  description: 'CSVログデータをインタラクティブな地図上に可視化する',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
