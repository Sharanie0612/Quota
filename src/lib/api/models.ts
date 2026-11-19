import { invoke } from "@tauri-apps/api/core";
import type { LadderPriceCheck, LadderSnapshot, TaskCostReport } from "../types";

export const modelsApi = {
  getTaskCost: () => invoke<TaskCostReport>("get_task_cost"),
  checkTaskCost: () => invoke<void>("check_task_cost"),
  refreshTaskCost: () => invoke<TaskCostReport>("refresh_task_cost"),
  saveTaskCostKey: (key: string) => invoke<TaskCostReport>("save_task_cost_key", { key }),
  reportBenchmarkSmoke: (report: unknown) => invoke<void>("benchmark_smoke_report", { report }),

  getLadder: () => invoke<LadderSnapshot>("get_ladder"),
  refreshLadder: (force = false) => invoke<LadderSnapshot>("refresh_ladder", { force }),
  checkLadderPrice: (id: string) => invoke<LadderPriceCheck>("check_ladder_price", { id }),
  adoptLadderPrice: (
    id: string, input: number, output: number, currency: string,
    cachedInput: number | null = null, cacheWrite: number | null = null, cacheWriteLong: number | null = null,
  ) => invoke<void>("adopt_ladder_price", { id, input, output, currency, cachedInput, cacheWrite, cacheWriteLong }),
};
