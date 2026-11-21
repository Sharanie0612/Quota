import { useEffect, useState, type ReactNode } from "react";
import { ActivitySourcesPanel } from "../components/ActivitySourcesPanel";
import { CrossDeviceSyncPanel } from "../components/CrossDeviceSyncPanel";
import type { AppInfo, Settings } from "../lib/types";
import { AboutSettings } from "./settings/AboutSettings";
import { BackupSettings } from "./settings/BackupSettings";
import { RefreshSettings } from "./settings/RefreshSettings";
import { WindowSettings } from "./settings/WindowSettings";
import { settingsSections, type SettingsSection } from "./settings/sections";

interface Props {
  settings: Settings | null;
  info: AppInfo | null;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onUpdate: (patch: Partial<Settings>) => void;
}

// An unopened panel does no work. Once visited, its inputs and in-progress
// operations survive switching sections until the user leaves Settings.
function SectionPanel({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!active && !visited) return null;
  return <div className="settings-section-content" hidden={!active}>{children}</div>;
}

export function SettingsView({ settings, info, section, onSectionChange, onUpdate }: Props) {
  if (!settings) return <div className="content-inner">
    <div className="card section"><div className="skeleton" style={{ height: 18, width: 160 }}/></div>
  </div>;
  return <div className="content-inner settings-page">
    <nav className="settings-section-nav" aria-label="设置分类">
      {settingsSections.map(({ id, title }) => <button type="button" key={id}
        className={section === id ? "is-active" : ""} aria-current={section === id ? "page" : undefined}
        onClick={() => onSectionChange(id)}>{title}</button>)}
    </nav>
    <SectionPanel active={section === "appearance"}><WindowSettings settings={settings} onUpdate={onUpdate}/></SectionPanel>
    <SectionPanel active={section === "sources"}><ActivitySourcesPanel/></SectionPanel>
    <SectionPanel active={section === "sync"}>
      <CrossDeviceSyncPanel active={section === "sync"}/><BackupSettings/>
    </SectionPanel>
    <SectionPanel active={section === "updates"}><RefreshSettings settings={settings} onUpdate={onUpdate}/></SectionPanel>
    <SectionPanel active={section === "about"}><AboutSettings info={info}/></SectionPanel>
  </div>;
}
