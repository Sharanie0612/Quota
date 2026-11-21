import { useCallback, useState } from "react";
import { api, errText } from "./api";
import { useReportQuery } from "./useReportQuery";

export function useOutputSpeed(device: string, model: string, days: number, minutes: number, grain: number) {
  const key = JSON.stringify([device, model, days, minutes, grain]);
  const read = useCallback(() => api.getOutputSpeed(device, "codex", days, model, grain, 0, minutes),
    [device, model, days, grain, minutes]);
  const report = useReportQuery(key, read, { pollMs: 5_000 });
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setFailure(null);
    try {
      await api.refreshOutputSpeed();
      report.reload();
    } catch (error) {
      setFailure({ key, message: errText(error) });
    } finally {
      setRefreshing(false);
    }
  };
  return { data: report.data, error: report.error || (failure?.key === key ? failure.message : ""), refresh, refreshing };
}
