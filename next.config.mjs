/** @type {import('next').NextConfig} */
const nextConfig = {
  // The library source (src/audit, src/guardrail, src/langgraph, etc.) uses
  // NodeNext module imports with .js extensions. Next.js (SWC bundler) handles
  // these correctly without any additional configuration.
};

export default nextConfig;
