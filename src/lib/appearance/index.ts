import {useSyncExternalStore} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {defaultPreferences,newerPreferences,normalizePreferences,type Preferences} from './preferences';
import {themeTokens} from './themes';
import type {WindowKind} from '../../window';
export {THEMES} from './themes';
export type {ThemeId,ColorMode} from './themes';

type Appearance=Preferences&{resolved:'light'|'dark'};
const KEY='quota.appearance.v1';
const initial:Appearance={...defaultPreferences,resolved:'light'};
let snapshot=initial;
let initialized=false;
const listeners=new Set<()=>void>();

function apply(preferences:Preferences) {
  const resolved=preferences.mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preferences.mode;
  snapshot={...preferences,resolved};
  const html=document.documentElement;
  for(const [key,value] of Object.entries(themeTokens(preferences.theme,resolved)))html.style.setProperty('--'+key,value);
  html.style.colorScheme=resolved;
  html.dataset.colorTheme=preferences.theme;
  html.dataset.colorMode=resolved;
  html.dataset.material=preferences.glass&&!matchMedia('(forced-colors: active)').matches?'frosted':'solid';
  for(const listener of listeners)listener();
}

function cache(preferences:Preferences) {
  try{localStorage.setItem(KEY,JSON.stringify(preferences));}catch{/* The current window remains usable when storage is unavailable. */}
}

function accept(value:unknown) {
  const next=newerPreferences(snapshot,value);
  if(next===snapshot)return;
  cache(next);apply(next);
}

export function initializeAppearance(kind:WindowKind) {
  if(initialized)return;
  initialized=true;document.documentElement.dataset.window=kind;
  if(kind==='setup'){apply({...defaultPreferences,mode:'light'});return;}
  let saved:Preferences|null=null;
  try{saved=normalizePreferences(JSON.parse(localStorage.getItem(KEY)||'null'));}catch{/* Use the default until native preferences arrive. */}
  apply(saved??defaultPreferences);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>apply(snapshot));
  matchMedia('(forced-colors: active)').addEventListener('change',()=>apply(snapshot));
  window.addEventListener('storage',event=>{
    if(event.key!==KEY)return;
    try{accept(JSON.parse(event.newValue||'null'));}catch{/* Ignore damaged external cache updates. */}
  });
  void listen<Preferences>('appearance-updated',event=>accept(event.payload))
    .then(()=>invoke<Preferences|null>('get_appearance')).then(accept).catch(()=>undefined);
}

export function setAppearance(patch:Partial<Pick<Preferences,'theme'|'mode'|'collapsed'|'glass'>>) {
  const preferences:Preferences={theme:snapshot.theme,mode:snapshot.mode,collapsed:snapshot.collapsed,glass:snapshot.glass,...patch,revision:Math.max(Date.now(),snapshot.revision+1)};
  cache(preferences);apply(preferences);
  void invoke('save_appearance',{preferences}).catch(()=>undefined);
}

export function useAppearance() {
  return useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener);},()=>snapshot,()=>initial);
}
