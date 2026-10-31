const production = process.env.NODE_ENV === 'production';

// Headers every response carries. HSTS is production only, so a local http server is not pinned to https.
const securityHeaders = [
  { key: 'X-Robots-Tag', value: 'noindex' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The analysis engine lives in ../chat-report and is imported as source.
  experimental: { externalDir: true },
  poweredByHeader: false,
  webpack(config) {
    // The engine imports "./x.js" for files that are "./x.ts".
    config.resolve.extensionAlias = { '.js': ['.ts', '.js'] };
    return config;
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
