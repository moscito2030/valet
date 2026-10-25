import type { Metadata } from 'next';
import Script from 'next/script';
import { createElement } from 'react';
import './globals.css';
import '@valet/deal-viewer/style.css';
const fontStylesheets = [
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&family=Source+Serif+4:wght@400;600;700&family=IBM+Plex+Sans:wght@500&family=IBM+Plex+Mono:wght@600&display=swap',
  'https://fonts.googleapis.com/css2?family=Libertinus+Serif:wght@600&text=VALET&display=swap',
];
export const metadata: Metadata = {
  title: 'Valet · 橋牌賽事記分',
  description: '隊制賽與雙人賽，即時成績、逐副比較與主辦收分。',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {fontStylesheets.map((href) => <link key={href} rel="preload" as="style" href={href} />)}
        <noscript>
          {fontStylesheets.map((href) => <link key={href} rel="stylesheet" href={href} />)}
        </noscript>
      </head>
      <body>
        <Script src="/theme.js" strategy="beforeInteractive" />
        {/* Keep font CSS out of the render-blocking app stylesheet dependency chain. */}
        <Script id="valet-font-stylesheets" strategy="afterInteractive">
          {`for (const href of ${JSON.stringify(fontStylesheets)}) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            document.head.appendChild(link);
          }`}
        </Script>
        {children}
        {createElement('valet-theme-picker')}
      </body>
    </html>
  );
}
