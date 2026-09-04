import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages are shipped as TypeScript source, so Next compiles them.
  transpilePackages: ['@pf/core'],
};

export default nextConfig;
