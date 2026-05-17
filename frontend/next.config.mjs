/** @type {import('next').NextConfig} */
const backendUrl =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'production'
    ? '' // In production on Vercel, NEXT_PUBLIC_API_URL MUST be set
    : 'http://localhost:3001');

const nextConfig = {
  async rewrites() {
    if (!backendUrl) {
      // If no backend URL is configured, skip rewrites (API calls will fail with a clear error)
      return [];
    }
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
