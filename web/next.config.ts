/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static export for easier deployment
  output: 'standalone',
  
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
