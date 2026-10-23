import type { NextConfig } from 'next';
const config: NextConfig = {
  devIndicators: process.env.NEXT_DIST_DIR === '.next-visual' ? false : undefined,
  distDir: process.env.NEXT_DIST_DIR === '.next-visual' ? '.next-visual' : '.next',
  env: {
    NEXT_PUBLIC_APP_COMMIT: /^[a-f0-9]{40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA ?? '') ? process.env.VERCEL_GIT_COMMIT_SHA! : '',
    NEXT_PUBLIC_APP_COMMIT_MESSAGE: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? '',
    NEXT_PUBLIC_APP_DEPLOYED: process.env.VERCEL === '1' ? '1' : '',
  },
  transpilePackages: ['@valet/deal-viewer'],
  poweredByHeader: false,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [{ source: '/manual/', destination: '/manual/index.html' }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
