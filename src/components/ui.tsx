/** 通用 UI 原语：按钮、徽标、开关、分段控件、弹层、提示条 */
import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconInfo, IconRefresh, IconX } from "./icons";
import { ToastStack } from "./ToastStack";
import { useSlidingHighlight } from "../lib/useSlidingHighlight";
import { WindowControls } from "./WindowControls";
import { AutoDismiss } from './AutoDismiss';
import { useAppearance } from '../lib/appearance';
import { motion } from '../lib/motion';

export function Button({
  children,
  variant = "default",
  size,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "quiet" | "danger";
  size?: "sm";
}) {
  const cls = [
    "btn",
    variant === "primary" ? "btn-primary" : "",
    variant === "quiet" ? "btn-quiet" : "",
    variant === "danger" ? "btn-danger" : "",
    size === "sm" ? "btn-sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({
  title,
  busy,
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string; busy?: boolean }) {
  return (
    <button
      className={`btn btn-icon ${className}`}
      title={title}
      aria-label={title}
      {...rest}
    >
      {busy ? <IconRefresh className="spin" size={15} /> : children}
    </button>
  );
}

export function Badge({
  children,
  tone = "gray",
  title,
}: {
  children: ReactNode;
  tone?: "gray" | "green" | "amber" | "red" | "blue";
  title?: string;
}) {
  return (
    <span className={`badge${tone === "gray" ? "" : ` badge-${tone}`}`} title={title}>
      {children}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  controls,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  controls?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={`switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
      aria-label={label}
      aria-pressed={checked}
      aria-controls={controls}
      aria-expanded={controls?checked:undefined}
      disabled={disabled}
      type="button"
    />
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const track = useSlidingHighlight<HTMLDivElement>(value);
  return (
    <div className="seg motion-seg" role="tablist" ref={track}>
      <span className="motion-highlight" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          data-motion-active={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={o.value === value ? "active" : ""}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const index = options.findIndex(option => option.value === o.value);
            const next = e.key === "ArrowRight" ? (index + 1) % options.length
              : e.key === "ArrowLeft" ? (index - 1 + options.length) % options.length
              : e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : -1;
            if (next < 0) return;
            e.preventDefault();
            onChange(options[next].value);
            e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="tab"]')[next]?.focus();
          }}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
  actions,
  autoDismiss = false,
  dismissKey,
}: {
  tone?: "info" | "warn" | "error";
  children: ReactNode;
  actions?: ReactNode;
  autoDismiss?: boolean;
  dismissKey?: string | number;
}) {
  const Icon = tone === "info" ? IconInfo : IconAlert;
  const content = (dismiss?: () => void) => (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : autoDismiss ? "status" : undefined}>
      <Icon size={14} />
      <div className="notice-text">
        <div>{children}</div>
        {actions ? <div className="notice-actions">{actions}</div> : null}
      </div>
      {dismiss && <button type="button" className="feedback-close" aria-label="关闭提示" onClick={dismiss}><IconX size={14}/></button>}
    </div>
  );
  if (!autoDismiss) return content();
  const text = (nodes: ReactNode): string => Children.toArray(nodes).map(node =>
    isValidElement<{children?: ReactNode}>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '').join('');
  return <AutoDismiss key={`${tone}:${dismissKey ?? ''}:${text(children)}`}>{dismiss => content(dismiss)}</AutoDismiss>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  maxWidth,
  dismissible = true,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode | ((close: () => void) => ReactNode);
  wide?: boolean;
  maxWidth?: number;
  dismissible?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const appearance = useAppearance();
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = () => { if (dismissible) setClosing(true); };
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => { onCloseRef.current(); setClosing(false); }, appearance.reducedMotion ? 0 : motion.exit);
    return () => window.clearTimeout(timer);
  }, [closing, appearance.reducedMotion]);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focused = document.activeElement;
    const previousFocus = focused instanceof HTMLElement || focused instanceof SVGElement ? focused : null;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog ref={dialogRef} className="overlay" data-closing={closing} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); close(); }}
      onKeyDown={(e) => {
        if (closing) { e.preventDefault(); return; }
        if (e.key !== "Tab") return;
        const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement | SVGElement>('button:enabled,input:enabled,select:enabled,textarea:enabled,a[href],summary,[tabindex]'))
          .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) { e.preventDefault(); e.currentTarget.focus(); return; }
        if (e.shiftKey && (document.activeElement === first || !controls.some(control => control === document.activeElement))) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" style={maxWidth || wide ? { maxWidth: maxWidth ?? 620 } : undefined}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <div className="spacer" />
          <IconButton title="关闭" onClick={close} disabled={!dismissible || closing} type="button">
            <IconX size={15} />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{typeof footer === 'function' ? footer(close) : footer}</div> : null}
      </div>
      <ToastStack />
      <div className="window-drag-region" data-tauri-drag-region aria-hidden="true"/>
      <WindowControls/>
    </dialog>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  let controlId: string | undefined;
  type ChildProps = { id?: string; type?: string; children?: ReactNode; "aria-describedby"?: string };
  const associate = (nodes: ReactNode): ReactNode => Children.map(nodes, child => {
    if (!isValidElement<ChildProps>(child)) return child;
    if (!controlId && ["input", "select", "textarea"].includes(String(child.type)) && child.props.type !== "hidden") {
      controlId = child.props.id || fieldId;
      const describedBy = [...new Set([...(child.props["aria-describedby"]?.split(/\s+/) ?? []), ...(hint ? [hintId] : [])])].filter(Boolean).join(" ");
      return cloneElement(child, { id: controlId, "aria-describedby": describedBy || undefined });
    }
    return child.props.children ? cloneElement(child, { children: associate(child.props.children) }) : child;
  });
  const controls = associate(children);
  return (
    <div className="field" role={controlId ? undefined : "group"} aria-labelledby={controlId ? undefined : `${fieldId}-label`}>
      <label id={`${fieldId}-label`} htmlFor={controlId}>{label}</label>
      {controls}
      {hint ? <div id={hintId} className="hint">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon: ReactNode;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark">{icon}</div>
      <h3>{title}</h3>
      {desc&&<p>{desc}</p>}
      {action}
    </div>
  );
}
