// Keep the supplied Q artwork pixel-for-pixel; only clip its white tile corners.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const original = join(root, "assets", "quota-logo-original.png");
const source = readFileSync(original);
if (source.toString("ascii", 1, 4) !== "PNG") {
  throw new Error(`Not a PNG: ${original}`);
}
const width = source.readUInt32BE(16);
const height = source.readUInt32BE(20);
if (width !== height) {
  throw new Error(`Icon must be square: ${width}x${height}`);
}

const radius = Math.round(width * 0.22);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><clipPath id="rounded"><rect width="${width}" height="${height}" rx="${radius}"/></clipPath></defs>
  <image width="${width}" height="${height}" href="data:image/png;base64,${source.toString("base64")}" clip-path="url(#rounded)"/>
</svg>`;
const generated = join(root, ".toolchain");
mkdirSync(generated, { recursive: true });
const svgPath = join(generated, "quota-icon-rounded.svg");
writeFileSync(svgPath, svg);

execFileSync(
  process.execPath,
  [join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"), "icon", svgPath],
  { cwd: root, stdio: "inherit" },
);
copyFileSync(join(root, "src-tauri", "icons", "icon.png"), join(root, "assets", "quota-icon-source.png"));
