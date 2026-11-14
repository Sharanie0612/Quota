/** 极简 toast + 账户数据 hook */

import { useCallback, useEffect, useState } from "react";
import { api, errText, events } from "./api";
import type { AccountView, Settings } from "./types";
import { motion } from './motion';

/* ---------------------------------------------------------------- toast */

export type ToastItem = { id: number; text: string; kind: "info" | "error"; leaving?: boolean };

let toastList: ToastItem[] = [];
const toastSubs = new Set<(list: ToastItem[]) => void>();
let toastSeq = 1;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

function publishToasts() { toastSubs.forEach(fn => fn(toastList)); }

export function dismissToast(id: number) {
  if (!toastList.some(item => item.id === id && !item.leaving)) return;
  clearTimeout(toastTimers.get(id));
  toastList = toastList.map(item => item.id === id ? {...item, leaving: true} : item);
  publishToasts();
  toastTimers.set(id, setTimeout(() => {
    toastList = toastList.filter(item => item.id !== id);
    toastTimers.delete(id);
    publishToasts();
  }, motion.exit));
}

export function toast(text: string, kind: "info" | "error" = "info") {
  // A repeated result replaces its deadline instead of stacking duplicate messages.
  const previous = toastList.filter(item => item.text === text && item.kind === kind);
  for (const item of previous) { clearTimeout(toastTimers.get(item.id)); toastTimers.delete(item.id); }
  toastList = toastList.filter(item => !previous.includes(item));
  const item: ToastItem = { id: toastSeq++, text, kind };
  toastList = [...toastList, item];
  while (toastList.length > 3) {
    const oldest = toastList.shift()!;
    clearTimeout(toastTimers.get(oldest.id)); toastTimers.delete(oldest.id);
  }
  publishToasts();
  toastTimers.set(item.id, setTimeout(() => dismissToast(item.id), motion.feedback));
}

export function useToasts(): ToastItem[] {
  const [list, setList] = useState<ToastItem[]>(toastList);
  useEffect(() => {
    toastSubs.add(setList);
    setList(toastList);
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
      return true;
    } catch (e) {
      toast(`刷新失败：${errText(e)}`, "error");
      return false;
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
