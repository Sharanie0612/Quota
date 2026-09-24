/** 极简 toast + 账户数据 hook */

import { useCallback, useEffect, useState } from "react";
import { api, errText, events } from "./api";
import type { AccountView, Settings } from "./types";

/* ---------------------------------------------------------------- toast */

export type ToastItem = { id: number; text: string; kind: "info" | "error" };

let toastList: ToastItem[] = [];
const toastSubs = new Set<(list: ToastItem[]) => void>();
let toastSeq = 1;

export function toast(text: string, kind: "info" | "error" = "info") {
  const item: ToastItem = { id: toastSeq++, text, kind };
  toastList = [...toastList, item];
  toastSubs.forEach((fn) => fn(toastList));
  setTimeout(() => {
    toastList = toastList.filter((t) => t.id !== item.id);
    toastSubs.forEach((fn) => fn(toastList));
  }, kind === "error" ? 6000 : 3200);
}

export function useToasts(): ToastItem[] {
  const [list, setList] = useState<ToastItem[]>(toastList);
  useEffect(() => {
    toastSubs.add(setList);
    return () => {
      toastSubs.delete(setList);
    };
  }, []);
  return list;
}

/* ---------------------------------------------------------------- 账户数据 */

export function useAccounts() {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setAccounts(await api.listAccounts());
    } catch (e) {
      toast(`读取账户失败：${errText(e)}`, "error");
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    (async () => {
      await reload();
      if (!disposed) setLoading(false);
    })();
    const un = events.onAccountsUpdated(() => {
      void reload();
    });
    return () => {
      disposed = true;
      void un.then((f) => f());
    };
  }, [reload]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      setAccounts(await api.refreshAll());
    } catch (e) {
      toast(`刷新失败：${errText(e)}`, "error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const refreshOne = useCallback(async (id: string) => {
    setRefreshing(true);
    try {
      const view = await api.refreshAccount(id);
      setAccounts((prev) => prev.map((a) => (a.id === view.id ? view : a)));
      return view;
    } catch (e) {
      toast(`刷新失败：${errText(e)}`, "error");
      return null;
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { accounts, setAccounts, loading, refreshing, reload, refreshAll, refreshOne };
}

/* ---------------------------------------------------------------- 设置 */

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let disposed = false;
    api
      .getSettings()
      .then((s) => !disposed && setSettings(s))
      .catch((e) => toast(`读取设置失败：${errText(e)}`, "error"));
    return () => {
      disposed = true;
    };
  }, []);

  const update = useCallback(async (next: Settings) => {
    try {
      const saved = await api.saveSettings(next);
      setSettings(saved);
      return saved;
    } catch (e) {
      toast(`保存设置失败：${errText(e)}`, "error");
      return null;
    }
  }, []);

  return { settings, update };
}
