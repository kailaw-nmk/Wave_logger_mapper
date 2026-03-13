import HomePage from '@/components/HomePage';

// 静的プリレンダリングを無効化（Leafletはブラウザ専用）
export const dynamic = 'force-dynamic';

export default function Page() {
  return <HomePage />;
}
