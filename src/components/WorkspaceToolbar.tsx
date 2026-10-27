import { useEffect, useState } from 'react';
import { api, errText, events } from '../lib/api';
import { IconChart, IconRefresh } from './icons';

export function WorkspaceToolbar({ onUsage, onSync }: { onUsage: () => void; onSync: () => void }) {
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.getWidgetUsage>> | null>(null);
  const [device, setDevice] = useState('本机');
  const [syncEnabled, setSyncEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      const [summary, options] = await Promise.allSettled([api.getWidgetUsage(), api.getActivityOptions()]);
      if (live) {
        if (summary.status === 'fulfilled') setUsage(summary.value);
        if (options.status === 'fulfilled') {
          setDevice(options.value.deviceName || '本机');
          setSyncEnabled(!!options.value.syncDir);
        }
        setError([summary, options].flatMap(result => result.status === 'rejected' ? [errText(result.reason)] : []).join('；'));
      }
      pending = false;
    };
    void load();
    const unlisten = events.onActivityUpdated(() => void load());
    window.addEventListener('focus', load);
    return () => { live = false; window.removeEventListener('focus', load); void unlisten.then(fn => fn()); };
  }, [retry]);
  const number = usage ? new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(usage.today) : '—';
  const updated = usage?.updatedAt ? new Date(usage.updatedAt).toLocaleString('zh-CN') : '尚未采集';
  return <div className="workspace-toolbar" aria-label="工作区状态与快捷操作">
    <div className="workspace-device" title={device}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8M12 17v4"/></svg>
      <span>{device}</span><small>本机工作区</small>
    </div>
    <div className="workspace-tools">
      {error && <button type="button" className="workspace-retry" title={error} onClick={() => setRetry(value => value + 1)}><IconRefresh size={13}/>重试读取</button>}
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
