#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SITE = join(ROOT, "site");
const OUT = join(ROOT, "out");
const ASSETS = join(ROOT, "assets");

const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".mp4", "video/mp4"],
]);

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function safeJoin(base, rel) {
  const decoded = decodeURIComponent(rel);
  const normalized = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = join(base, normalized);
  const root = base.endsWith(sep) ? base : `${base}${sep}`;
  if (abs !== base && !abs.startsWith(root)) return null;
  return abs;
}

function resolveRequest(urlPath) {
  const cleanPath = urlPath.replace(/^\/academy(?=\/|$)/, "") || "/";
  if (cleanPath.startsWith("/videos/")) {
    return safeJoin(OUT, cleanPath.slice("/videos/".length));
  }
  if (cleanPath.startsWith("/media/")) {
    return safeJoin(ASSETS, cleanPath.slice("/media/".length));
  }
  return safeJoin(SITE, cleanPath === "/" ? "index.html" : cleanPath.slice(1));
}

function send404(res) {
  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end("Not found\n");
}

function parseRange(range, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range || "");
  if (!match) return null;
  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return null;
  let start = rawStart ? Number(rawStart) : Math.max(0, size - Number(rawEnd));
  let end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (start > end) return null;
  return { start, end };
}

function serveFile(req, res, file) {
  if (!file || !existsSync(file)) return send404(res);
  const stat = statSync(file);
  if (!stat.isFile()) return send404(res);

  const type = TYPES.get(extname(file).toLowerCase()) || "application/octet-stream";
  const common = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  const range = parseRange(req.headers.range, stat.size);
  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      ...common,
      "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
      "Content-Length": length,
    });
    if (req.method === "HEAD") return res.end();
    return createReadStream(file, range).pipe(res);
  }

  res.writeHead(200, {
    ...common,
    "Content-Length": stat.size,
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

const port = Number(argValue("--port", process.env.PORT || "8080"));
const host = argValue("--host", process.env.HOST || "::");

createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    serveFile(req, res, resolveRequest(url.pathname));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`${err instanceof Error ? err.message : err}\n`);
  }
}).listen(port, host, () => {
  console.log(`[serve-academy] http://localhost:${port}/`);
  console.log(`[serve-academy] site=${SITE}`);
  console.log(`[serve-academy] videos=/videos/* -> ${OUT}`);
  console.log(`[serve-academy] media=/media/* -> ${ASSETS}`);
});
