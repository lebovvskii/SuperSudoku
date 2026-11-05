import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'SuperSudoku',
  description: 'Судоку без рекламы: офлайн, прогресс и приватная синхронизация.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
