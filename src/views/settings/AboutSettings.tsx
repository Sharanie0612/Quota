import { IconInfo } from "../../components/icons";
import { Button } from "../../components/ui";
import { copyText } from "../../lib/api";
import { toast } from "../../lib/store";
import type { AppInfo } from "../../lib/types";

export function AboutSettings({ info }: { info: AppInfo | null }) {
  return (
    <div className="card section">
      <h2>
        <IconInfo size={14} /> 数据与安全
      </h2>
      <div className="setting-row">
        <div className="txt">
          <b>API Key 存放位置</b>
          <span>系统凭据库（Windows 凭据管理器 / macOS 钥匙串）</span>
        </div>
      </div>
      <div className="setting-row">
        <div className="txt">
          <b>配置文件目录</b>
          <div className="mono" style={{ marginTop: 6 }}>
            {info?.configDir ?? "读取中…"}
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => {
            if (info?.configDir) {
              void copyText(info.configDir)
                .then(() => toast("已复制目录路径"))
                .catch(() => toast("复制失败，请手动选中路径复制", "error"));
            }
          }}
        >
          复制路径
        </Button>
      </div>
      <div className="setting-row">
        <div className="txt">
          <b>版本</b>
          <span>Quota {info?.version ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}
