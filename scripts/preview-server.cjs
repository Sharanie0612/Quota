/* 本地静态预览服务器：把 dist-mock 目录跑在 http 上，方便在浏览器里核对界面。
   用法：node scripts/preview-server.js [port]   默认 4174
   悬浮卡预览：http://127.0.0.1:4174/?window=tray */
const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.argv[2] || 4174);
const root = path.join(__dirname, "..", "dist-mock");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(root, urlPath === "/" ? "index.html" : urlPath);
    if (!file.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(buf);
    });
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`preview: http://127.0.0.1:${port}/  (tray: /?window=tray)`);
  });
