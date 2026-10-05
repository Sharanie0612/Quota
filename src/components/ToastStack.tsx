import { useToasts } from "../lib/store";

/** 原生模态弹窗位于顶层，提示也须置于该弹窗内，才能看到并被朗读。 */
export function ToastStack() {
  const toasts = useToasts();
  return <div className="toasts" role="status" aria-live="polite" aria-relevant="additions">
    {toasts.map(item => <div key={item.id} className={`toast${item.kind === "error" ? " error" : ""}`}>{item.text}</div>)}
  </div>;
}
