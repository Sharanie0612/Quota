import appIcon from "../../src-tauri/icons/128x128.png";
import { useSlidingHighlight } from "../lib/useSlidingHighlight";
import { GlassMaterial } from "./GlassMaterial";
import { pageIds, workspacePages, type WorkspacePage } from "../lib/workspacePages";

interface Props {
  page: WorkspacePage;
  collapsed: boolean;
  count: number;
  lowCount: number;
  version?: string;
  onNavigate: (page: WorkspacePage) => void;
  onToggle: () => void;
}

export function WorkspaceSidebar({ page, collapsed, count, lowCount, version, onNavigate, onToggle }: Props) {
  const nav = useSlidingHighlight<HTMLElement>(page);
  return <aside className="sidebar material-plane" id="main-sidebar">
    <GlassMaterial/>
    <div className="sidebar-header">
      <div className="brand" data-tauri-drag-region>
        <img className="brand-mark" src={appIcon} alt="" aria-hidden="true"/>
        <div className="brand-text"><span className="brand-title">Quota</span></div>
      </div>
      <button type="button" className="sidebar-toggle" aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        title={collapsed ? "展开侧边栏" : "收起侧边栏"} aria-expanded={!collapsed} aria-controls="main-sidebar" onClick={onToggle}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path d={collapsed ? "m12 9 3 3-3 3" : "m16 9-3 3 3 3"}/>
        </svg>
      </button>
    </div>
    <nav className="sidebar-nav" ref={nav} aria-label="主导航">
      <span className="motion-highlight" aria-hidden="true"/>
      {pageIds.map(id => {
        const { title, icon: Icon } = workspacePages[id];
        const active = page === id;
        return <button key={id} type="button" className={active ? "nav-item active" : "nav-item"}
          data-motion-active={active} aria-current={active ? "page" : undefined} aria-label={title} title={title} onClick={() => onNavigate(id)}>
          <Icon size={id === "accounts" || id === "settings" ? 16 : 17}/>
          <span className="nav-label">{title}</span>
          {id === "accounts" && <span className="count">{count || ""}</span>}
        </button>;
      })}
    </nav>
    <div className="sidebar-foot">
      {lowCount > 0 && <div className="sidebar-alert" style={{ color: "var(--red)", marginBottom: 6 }}>{lowCount} 个账户余额不足</div>}
      Quota {version}
    </div>
  </aside>;
}
