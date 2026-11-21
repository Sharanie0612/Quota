import { api } from '../lib/api';
import { useReportQuery } from '../lib/useReportQuery';
import { IconChart, IconRefresh } from './icons';
import {GlassMaterial} from './GlassMaterial';

export function WorkspaceToolbar({ onUsage, onSync }: { onUsage: () => void; onSync: () => void }) {
  const summary = useReportQuery('toolbar-usage', api.getWidgetUsage, { onWindowFocus: true });
  const options = useReportQuery('toolbar-options', api.getActivityOptions, { onWindowFocus: true });
  const usage = summary.data;
  const device = options.data?.deviceName || '本机';
  const syncEnabled = options.data ? !!options.data.syncDir : null;
  const error = [summary.error, options.error].filter(Boolean).join('；');
  const number = usage ? new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(usage.today) : '—';
  const updated = usage?.updatedAt ? new Date(usage.updatedAt).toLocaleString('zh-CN') : '尚未采集';
  return <div className="workspace-toolbar material-plane" aria-label="工作区状态与快捷操作">
    <GlassMaterial/>
    <div className="workspace-device" title={device}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8M12 17v4"/></svg>
      <span>{device}</span><small>本机工作区</small>
    </div>
    <div className="workspace-tools">
      {error && <button type="button" className="workspace-retry" title={error} onClick={() => { summary.reload(); options.reload(); }}><IconRefresh size={13}/>重试读取</button>}
      <button type="button" className="workspace-usage" title={`今日用量${usage?.partial ? '（部分数据待采集）' : ''} · 上次更新：${updated}`} onClick={onUsage}>
        <IconChart size={15}/><span>今日 Token</span><strong>{number}{usage?.partial ? '*' : ''}</strong>
      </button>
      <span className="workspace-divider" aria-hidden="true"/>
      <button type="button" className="workspace-sync" title="打开跨设备同步设置" onClick={onSync}>
        <IconRefresh size={14}/>{syncEnabled === null ? '同步设置' : syncEnabled ? '管理同步' : '开启同步'}<span aria-hidden="true">↗</span>
      </button>
    </div>
  </div>;
}
