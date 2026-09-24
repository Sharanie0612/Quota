/** 内联 SVG 图标（线条风格贴近 SF Symbols） */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: P) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const IconRefresh = (p: P) => (
  <Base {...p}>
    <path d="M20 11A8 8 0 1 0 18.6 16" />
    <path d="M20 5v6h-6" />
  </Base>
);

export const IconWallet = (p: P) => (
  <Base {...p}>
    <rect x="3" y="6" width="18" height="13" rx="3.2" />
    <path d="M3 10h18" />
    <circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
  </Base>
);

export const IconLayers = (p: P) => (
  <Base {...p}>
    <path d="M12 3.5 3.5 8l8.5 4.5L20.5 8 12 3.5Z" />
    <path d="M3.5 13 12 17.5 20.5 13" />
  </Base>
);

export const IconGear = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2v.17a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.03 4.24l.06.06A1.7 1.7 0 0 0 9 4.6h.08A1.7 1.7 0 0 0 10.6 3h.01a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 16.1 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 20.4 9v.08a1.7 1.7 0 0 0 1.6 1.52H22a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.4Z" />
  </Base>
);

export const IconExternal = (p: P) => (
  <Base {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
  </Base>
);

export const IconPencil = (p: P) => (
  <Base {...p}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="M13.5 5.5 16 8" />
  </Base>
);

export const IconTrash = (p: P) => (
  <Base {...p}>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
    <path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" />
  </Base>
);

export const IconSearch = (p: P) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.4" />
    <path d="m16 16 3.6 3.6" />
  </Base>
);

export const IconX = (p: P) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const IconCheck = (p: P) => (
  <Base {...p}>
    <path d="m5 13 4.5 4.5L19 6.5" />
  </Base>
);

export const IconAlert = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.8v5" />
    <circle cx="12" cy="16.2" r="1" fill="currentColor" stroke="none" />
  </Base>
);

export const IconInfo = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11v5.2" />
    <circle cx="12" cy="7.9" r="1" fill="currentColor" stroke="none" />
  </Base>
);

export const IconSpark = (p: P) => (
  <Base {...p}>
    <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5Z" />
  </Base>
);

export const IconChart = (p: P) => (
  <Base {...p}>
    <path d="M4 19.5h16" />
    <path d="M7 19.5V12M12 19.5V6.5M17 19.5v-5" />
  </Base>
);

export const IconClock = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.5V12l3 2" />
  </Base>
);

/** 比价：天平 */
export const IconScale = (p: P) => (
  <Base {...p}>
    <path d="M12 4v16" />
    <path d="M7 20h10" />
    <path d="M4 8h16" />
    <path d="M4 8l-2 5h4L4 8Z" />
    <path d="M20 8l-2 5h4l-2-5Z" />
    <path d="M12 4.5a1.2 1.2 0 1 0 0-.1Z" fill="currentColor" stroke="none" />
  </Base>
);

/** 向下的箭头（导入/采用） */
export const IconDownload = (p: P) => (
  <Base {...p}>
    <path d="M12 4v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M5 19.5h14" />
  </Base>
);

/** 金额/余额趋势（托盘用） */
export const IconCoins = (p: P) => (
  <Base {...p}>
    <ellipse cx="9" cy="7" rx="5.5" ry="2.6" />
    <path d="M3.5 7v4c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6V7" />
    <path d="M14.5 11.4c2.7.2 5 1.3 5 2.6v4c0 1.4-2.5 2.6-5.5 2.6-2.3 0-4.3-.7-5.1-1.7" />
  </Base>
);

/** 复制 */
export const IconCopy = (p: P) => (
  <Base {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.4" />
    <path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-8a2 2 0 0 0-2 2v8a1 1 0 0 0 1 1h1" />
  </Base>
);

/** 问号（使用指引） */
export const IconHelp = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 1.9-2.5 3.4" />
    <circle cx="12" cy="16.4" r="1" fill="currentColor" stroke="none" />
  </Base>
);

/** 眼睛（恢复显示） */
export const IconEye = (p: P) => (
  <Base {...p}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.7" />
  </Base>
);

/** 闭眼（隐藏该模型） */
export const IconEyeOff = (p: P) => (
  <Base {...p}>
    <path d="M2.5 12S6 5.8 12 5.8c1.6 0 3 .4 4.2 1.1M21.5 12s-1.4 2.7-3.9 4.6c-1 .8-2.2 1.3-3.6 1.5" />
    <path d="M10 6.2A6.7 6.7 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-2.2 3" />
    <path d="M4.4 8.2A16.6 16.6 0 0 0 2.5 12s3.5 6.2 9.5 6.2c1.2 0 2.3-.2 3.3-.6" />
    <path d="m4 4 16 16" />
  </Base>
);
