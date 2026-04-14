import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/snes-web-synth",
  images: {
    unoptimized: true,
  },
}

export default nextConfig
