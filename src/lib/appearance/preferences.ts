import {THEMES,type ColorMode,type ThemeId} from './themes';

/** Keep the persisted glass boolean so installed preferences remain compatible. */
export type Preferences={theme:ThemeId;mode:ColorMode;collapsed:boolean;glass:boolean;revision:number};
export const defaultPreferences:Preferences={theme:'quota',mode:'system',collapsed:false,glass:false,revision:0};

export function normalizePreferences(value:unknown):Preferences|null {
  if(!value||typeof value!=='object')return null;
  const p=value as Record<string,unknown>;
  if(!THEMES.some(t=>t.id===p.theme)||typeof p.mode!=='string'||!['system','light','dark'].includes(p.mode))return null;
  if(typeof p.collapsed!=='boolean'||(p.glass!==undefined&&typeof p.glass!=='boolean'))return null;
  const revision=p.revision??0;
  if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0)return null;
  return {theme:revision===0?'quota':p.theme as ThemeId,mode:p.mode as ColorMode,collapsed:p.collapsed,glass:p.glass===true,revision};
}

export function newerPreferences(current:Preferences,value:unknown):Preferences {
  const next=normalizePreferences(value);
  return next&&next.revision>=current.revision?next:current;
}
