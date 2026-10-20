import type { Metadata } from 'next';
import Script from 'next/script';
import { createElement } from 'react';
import './globals.css';
import '@valet/deal-viewer/style.css';
export const metadata: Metadata = {
  title: 'Valet · 橋牌賽事記分',
  description: '隊制賽與雙人賽，即時成績、逐副比較與主辦收分。',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body>
        <Script src="/theme.js" strategy="beforeInteractive" />
        {children}
        {createElement('valet-theme-picker')}
      </body>
    </html>
  );
}
