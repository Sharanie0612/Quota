import { useCallback, useState } from "react";
import { api, errText } from "./api";
import type { ActivityRange } from "./activityCharts";
import type { ActivityFilters } from "./types";
import { useReportQuery } from "./useReportQuery";

export type ActivitySelection = { query: string; range: ActivityRange };

export function useActivityReport(filters: ActivityFilters, days: string, model: string, selection: ActivitySelection | null) {
  const modelScope = JSON.stringify([filters, days]);
  const query = JSON.stringify([filters, days, model]);
  const read = useCallback(async () => ({
    scope: modelScope,
    report: await api.getActivity("", "", Number(days), model, "", "", filters),
  }), [modelScope, filters, days, model]);
  const overview = useReportQuery(query, read, { pollMs: 15_000 });
  const data = overview.data?.report;

  const range = selection?.query === query ? selection.range : null;
  const from = range?.from ?? "";
  const to = range?.to ?? "";
  const readRange = useCallback(() => api.getActivity("", "", Number(days), model, from, to, filters),
    [filters, days, model, from, to]);
  const detail = useReportQuery(JSON.stringify([query, from, to]), readRange, { enabled: !!range, pollMs: 15_000 });

  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState("");
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.refreshActivity();
      setSyncError("");
      overview.reload();
      detail.reload();
    } catch (error) {
      setSyncError(errText(error));
    } finally {
      setBusy(false);
    }
  };
  return {
    query, modelScope, range, data, loading: overview.loading, readError: overview.error,
    load: overview.reload, rangeError: detail.error, detailData: range ? detail.data : data,
    choices: data ?? overview.previous?.report,
    availableModels: data?.availableModels ?? (overview.previous?.scope === modelScope ? overview.previous.report.availableModels : []) ?? [],
    busy, syncError, refresh,
  };
}
