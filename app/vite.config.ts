import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A single-page build: one index.html, one JS bundle and one stylesheet under
// assets/, plus whatever public/ contains. Deployed to S3 behind CloudFront,
// which serves index.html for any path it cannot find - so there is no server,
// and every route is resolved in the browser by react-router.
export default defineConfig({
  plugins: [react()],

  // The same "@/..." specifiers the codebase already used under Next. tsconfig's
  // `paths` only teaches the type checker; the bundler needs telling separately,
  // and the two must agree or imports resolve in the editor and fail in a build.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },

  // Vite only exposes variables whose names carry a listed prefix. NEXT_PUBLIC_
  // is kept alongside its own so .env.local, and any deployment that already
  // sets these, keep working unchanged - the names appear in the API client and
  // the Cognito service, read there as import.meta.env.
  //
  // As under Next, anything with this prefix is inlined into the bundle and is
  // therefore public. Nothing secret may be named this way.
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],

  // Pinned, and strict about it: the CDP suites in ../temp drive this exact
  // origin, and Vite's default behaviour of silently moving to the next free
  // port would leave them talking to nothing.
  server: { port: 5173, strictPort: true },

  build: {
    outDir: "dist",
    // One bundle is the point here, so the 500 kB warning would fire on every
    // build with nothing to act on. Cloudscape is most of the weight and the
    // whole console uses it, so splitting it out would only mean two requests
    // for the same bytes. The limit is set just above the current size, not
    // switched off - a jump past it is still worth a look.
    chunkSizeWarningLimit: 1800,
  },
});
