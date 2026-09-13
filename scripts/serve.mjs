import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, extname, sep } from "node:path";
const root = resolve("dist");
const rules = [];
for (const line of (await readFile(resolve(root, "_headers"), "utf8")).split(
  "\n",
)) {
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  if (!/^\s/.test(line)) {
    const expression = line
      .trim()
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    rules.push({ pattern: new RegExp("^" + expression + "$"), headers: {} });
  } else {
    const colon = line.indexOf(":");
    if (colon < 0 || !rules.length) throw Error("Invalid _headers line");
    rules.at(-1).headers[line.slice(0, colon).trim().toLowerCase()] = line
      .slice(colon + 1)
      .trim();
  }
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".parquet": "application/octet-stream",
};
createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const headers = {
      "content-type": mime[extname(file)] ?? "application/octet-stream",
      "accept-ranges": "bytes",
    };
    for (const rule of rules)
      if (rule.pattern.test(pathname)) Object.assign(headers, rule.headers);
    let start = 0,
      end = info.size - 1,
      status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!match) {
        res.writeHead(416, { "content-range": `bytes */${info.size}` });
        res.end();
        return;
      }
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= info.size) {
        res.writeHead(416, { "content-range": `bytes */${info.size}` });
        res.end();
        return;
      }
      status = 206;
      headers["content-range"] = `bytes ${start}-${end}/${info.size}`;
    }
    headers["content-length"] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file, { start, end })
      .on("error", () => res.destroy())
      .pipe(res);
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 500);
    res.end();
  }
}).listen(4173, "127.0.0.1", () =>
  console.log("SQL Grind ready on http://127.0.0.1:4173"),
);
