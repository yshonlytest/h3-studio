import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "public/dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: "client/main.ts",
      name: "H3StudioBundle",
      formats: ["iife"],
      fileName: () => "studio.js",
    },
  },
});
