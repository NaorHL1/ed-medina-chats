/** @type {import('next').NextConfig} */
const nextConfig = {
  // The analysis engine lives in ../chat-report and is imported as source.
  experimental: { externalDir: true },
  webpack(config) {
    // The engine imports "./x.js" for files that are "./x.ts".
    config.resolve.extensionAlias = { '.js': ['.ts', '.js'] };
    return config;
  },
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] }];
  },
};
export default nextConfig;
