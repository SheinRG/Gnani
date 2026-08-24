import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Pin the project root. Next otherwise walks up looking for a lockfile and
   * can latch onto an unrelated one outside the repository.
   */
  turbopack: { root: import.meta.dirname },

  /**
   * These packages exist to deliver a native executable. The bundler must not
   * try to parse `ffprobe.exe` as a JavaScript module -- marking them external
   * leaves them as plain runtime requires and copies the package across intact.
   */
  serverExternalPackages: ["ffmpeg-static", "@ffprobe-installer/ffprobe"],

  /**
   * Being external gets the package's *JavaScript* deployed. It does not
   * guarantee the sibling binary comes along, because nothing imports it.
   * These globs say so explicitly. Without them ffmpeg works on localhost and
   * fails with ENOENT in production -- the exact bug this spike exists to catch.
   *
   * @ffprobe-installer resolves to a platform-specific sub-package
   * (linux-x64 on Vercel, win32-x64 locally), so the glob covers the scope.
   */
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/ffmpeg-static/**",
      "./node_modules/@ffprobe-installer/**",
    ],
  },
};

export default nextConfig;
