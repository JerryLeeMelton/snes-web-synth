import type { NextConfig } from "next"

// Kept as a constant so it can be exposed to client code via
// NEXT_PUBLIC_BASE_PATH. AudioWorklet.addModule() takes a raw URL and does
// not automatically respect Next.js basePath, so client code has to prefix
// asset URLs itself.
const basePath = "/snes-web-synth"

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
