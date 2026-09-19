import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@aftershock/schema'],
  typedRoutes: false,
};

export default nextConfig;
