"""兼容旧入口；实际圆角裁切与 Tauri 图标生成由 Node 脚本完成。"""

from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
subprocess.run(["node", str(ROOT / "scripts" / "make_icon.mjs")], cwd=ROOT, check=True)
