/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standard Next.js server build. Deploy with `yarn build` then `yarn start`.
  // (No `output: 'standalone'` — Next serves CSS/static assets automatically,
  //  so there is no manual asset-copy step and no missing-CSS trap.)

  // Environment variables
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
  },
  
  // Optimize images
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
