/** 通用 UI 原语：按钮、徽标、开关、分段控件、弹层、提示条 */
import { useEffect, type ReactNode } from "react";
import { IconAlert, IconInfo, IconRefresh, IconX } from "./icons";

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
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
      aria-label={label}
      aria-pressed={checked}
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
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? "active" : ""}
          onClick={() => onChange(o.value)}
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
}: {
  tone?: "info" | "warn" | "error";
  children: ReactNode;
  actions?: ReactNode;
}) {
  const Icon = tone === "info" ? IconInfo : IconAlert;
  return (
    <div className={`notice notice-${tone}`}>
      <Icon size={14} />
      <div className="notice-text">
        <div>{children}</div>
        {actions ? <div className="notice-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 620 } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <div className="spacer" />
          <IconButton title="关闭" onClick={onClose} type="button">
            <IconX size={15} />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
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
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
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
  desc: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark">{icon}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
      {action}
    </div>
  );
}
