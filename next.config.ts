import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    // Vinext's local image optimizer can fail when the asset binding is not ready.
    // Serve our already-optimized hero artwork directly instead.
    unoptimized: true,
  },
};

export default nextConfig;
