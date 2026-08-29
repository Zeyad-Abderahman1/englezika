import type { NextConfig } from 'next';
import { assertPlatformEnv } from './app/lib/env';

export default function nextConfig(): NextConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) assertPlatformEnv();

  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src 'self'${isProduction ? '' : ' ws: http:'}`,
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]
    .join('; ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const securityHeaders = [
    {
      key: 'Content-Security-Policy',
      value: contentSecurityPolicy,
    },
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=()',
    },
    ...(isProduction
      ? [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ]
      : []),
  ];

  const embedContentSecurityPolicy = [
    "default-src 'none'",
    "script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    "connect-src https://www.youtube.com https://*.googlevideo.com",
    "img-src data: https://i.ytimg.com https://*.ggpht.com",
    "style-src 'unsafe-inline'",
    "frame-ancestors 'self'",
  ].join('; ');

  return {
    output: 'standalone',
    poweredByHeader: false,
    compress: true,
    images: {
      // These assets are pre-compressed WebP files and are served directly.
      unoptimized: true,
    },
    async headers() {
      return [
        {
          source: '/:path*',
          headers: securityHeaders,
        },
        {
          source: '/api/videos/:id/embed',
          headers: [
            {
              key: 'Content-Security-Policy',
              value: embedContentSecurityPolicy,
            },
            {
              key: 'X-Frame-Options',
              value: 'SAMEORIGIN',
            },
          ],
        },
        {
          source: '/:asset(teacher-hero-v2.webp|og.webp)',
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
        },
      ];
    },
    experimental: {
      serverActions: {
        bodySizeLimit: '10mb',
      },
    },
  };
}
