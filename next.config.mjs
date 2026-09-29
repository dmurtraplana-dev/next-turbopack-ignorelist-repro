/** @type {import('next').NextConfig} */
const nextConfig = {
  // WORKAROUND: set REPRO_EXTERNAL=1 to load the package from node_modules instead of
  // bundling it. The warning then no longer prints.
  ...(process.env.REPRO_EXTERNAL === "1" && {
    serverExternalPackages: ["side-effect-sdk", "side-effect-sdk-nomap"],
  }),
};
export default nextConfig;
