import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// BASE_PATH lets the same build serve from a subpath, such as a GitHub project
// page at /<repo>/. Manifest asset paths stay root-absolute identities; only
// their fetch URLs carry this prefix (see assetUrl in src/lib/challenges.ts).
const base = process.env.BASE_PATH ?? "/";

// Hosts that read public/_headers (Netlify, Cloudflare Pages, scripts/serve.mjs)
// apply the full policy. GitHub Pages serves no custom headers, so the built
// document carries the document-level part of the same policy itself.
const CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'";

export default defineConfig({
  base,
  plugins: [
    svelte(),
    {
      name: "sql-grind-csp-meta",
      apply: "build",
      transformIndexHtml(html) {
        return html.replace(
          "<head>",
          `<head><meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
        );
      },
    },
  ],
  server: { host: "127.0.0.1" },
  build: { target: "es2022" },
});
