"""Start a macOS build with isolated data and collection/network work disabled."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

binary = Path(sys.argv[1]).resolve(strict=True)
with tempfile.TemporaryDirectory(prefix="quota-startup-") as temporary:
    directory = Path(temporary)
    config = {
        "version": 1,
        "accounts": [],
        "settings": {
            "autoRefresh": False, "refreshIntervalMinutes": 30,
            "notifyLowBalance": False, "closeToTray": False,
            "defaultLowThreshold": 20, "notifyRecharge": False,
            "trayAlert": False, "ladderAutoUpdate": False,
        },
    }
    activity = {
        "deviceId": str(uuid.uuid4()), "deviceName": "CI startup check",
        "autoCollect": False, "collectIntervalSeconds": 30,
        "syncAccounts": False, "syncDir": "", "codexHome": "",
        "zcodeHome": "", "harnessHome": "", "traeHome": "",
        "traeEnabled": False, "codexSshDevices": [],
    }
    for name, value in [("config.json", config), ("activity-settings.json", activity),
                        ("usage-widget.json", {"enabled": False, "side": "right", "heightPercent": 50})]:
        (directory / name).write_text(json.dumps(value), encoding="utf-8")
    environment = dict(os.environ, QUOTA_DATA_DIR=str(directory))
    with (directory / "startup.log").open("w+") as log:
        process = subprocess.Popen([str(binary)], env=environment, stdout=log, stderr=log)
        try:
            time.sleep(8)
            if process.poll() is not None:
                log.seek(0)
                raise RuntimeError(f"Quota exited during startup ({process.returncode}): {log.read()}")
            print("PASS: isolated macOS startup survived 8 seconds")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
