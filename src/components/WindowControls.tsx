import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { errText } from '../lib/api';
import { toast } from '../lib/store';

/** These controls deliberately live in the application surface, without a title bar. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let live = true;
    type State = {maximized: boolean; fullscreen: boolean; square: boolean};
    const apply = (state: State) => {
      if (!live) return;
      setMaximized(state.maximized);
      document.querySelector('.app')?.setAttribute('data-window-shape', state.square ? 'square' : 'rounded');
    };
    const unlisten = listen<State>('main-window-state', event => apply(event.payload));
    void unlisten.then(() => invoke<State>('get_main_window_state')).then(apply).catch(() => undefined);
    return () => { live = false; void unlisten.then(fn => fn()).catch(() => undefined); };
  }, []);
  const run = (action: 'minimize' | 'toggleMaximize' | 'close') => {
    void getCurrentWindow()[action]().catch(error => toast(errText(error), 'error'));
  };
  return <div className="window-controls" role="group" aria-label="窗口控制">
    <button type="button" title="最小化" aria-label="最小化窗口" onClick={() => run('minimize')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5h10"/></svg></button>
    <button type="button" title={maximized ? '还原' : '最大化'} aria-label={maximized ? '还原窗口' : '最大化窗口'} onClick={() => run('toggleMaximize')}><svg viewBox="0 0 16 16" aria-hidden="true">{maximized ? <><path d="M5.5 5.5V3h8v8H11"/><rect x="2.5" y="5.5" width="8" height="8" rx="1"/></> : <rect x="3" y="3" width="10" height="10" rx="1"/>}</svg></button>
    <button type="button" className="window-close" title="关闭" aria-label="关闭窗口" onClick={() => run('close')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg></button>
  </div>;
}
