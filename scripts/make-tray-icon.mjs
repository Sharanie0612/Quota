// Resize the transparent tray artwork independently of the application tile.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(join(root, "assets", "quota-tray-source.png"));
if (source.toString("ascii", 1, 4) !== "PNG" || source.readUInt32BE(16) !== source.readUInt32BE(20)) {
  throw new Error("Expected square transparent PNG tray artwork");
}
const generated = join(root, ".toolchain", "tray-icons");
mkdirSync(generated, { recursive: true });
// The artwork occupies x=156..1090, y=165..1075 on a normalized 1280px canvas.
// Keep transparent padding while filling the small notification-area slot.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="96 96 1056 1056">
  <image width="1280" height="1280" href="data:image/png;base64,${source.toString("base64")}"/>
</svg>`;
const svgPath = join(generated, "tray.svg");
writeFileSync(svgPath, svg);
execFileSync(process.execPath,
  [join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"), "icon", svgPath, "--output", generated, "--png", "64"],
  { cwd: root, stdio: "inherit" });
copyFileSync(join(generated, "64x64.png"), join(root, "src-tauri", "icons", "tray.png"));
