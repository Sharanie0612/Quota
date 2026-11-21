import { IconChart, IconClock, IconGear, IconSpark, IconSpeed, IconWallet } from "../components/icons";

export const workspacePages = {
  accounts: { title: "账户总览", icon: IconWallet, wide: false },
  costs: { title: "我的使用", icon: IconChart, wide: true },
  "ai-models": { title: "AI 模型", icon: IconSpark, wide: true },
  activity: { title: "Token 活动", icon: IconClock, wide: false },
  "output-speed": { title: "输出速度", icon: IconSpeed, wide: true },
  settings: { title: "设置", icon: IconGear, wide: false },
} as const;

export type WorkspacePage = keyof typeof workspacePages;
export const pageIds = Object.keys(workspacePages) as WorkspacePage[];

export function isWorkspacePage(value: string): value is WorkspacePage {
  return Object.prototype.hasOwnProperty.call(workspacePages, value);
}
