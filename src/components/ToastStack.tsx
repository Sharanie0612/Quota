import { dismissToast, useToasts } from "../lib/store";
import { IconX } from './icons';

/** 原生模态弹窗位于顶层，提示也须置于该弹窗内，才能看到并被朗读。 */
export function ToastStack() {
  const toasts = useToasts();
  return <div className="toasts" role="status" aria-live="polite" aria-relevant="additions">
    {toasts.map(item => <div key={item.id} className={`toast${item.kind === "error" ? " error" : ""}`} data-leaving={!!item.leaving}>
      <span>{item.text}</span><button type="button" className="feedback-close" aria-label="关闭提示" onClick={() => dismissToast(item.id)}><IconX size={14}/></button>
    </div>)}
  </div>;
}
