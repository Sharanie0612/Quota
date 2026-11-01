import {THEMES,type ColorMode,type ThemeId} from './themes';

/** Keep legacy glass and migrate an enabled 3404 frosted preference without rewriting it. */
export type Preferences={theme:ThemeId;mode:ColorMode;collapsed:boolean;glass:boolean;reduceEffects:boolean;revision:number};
export const defaultPreferences:Preferences={theme:'quota',mode:'system',collapsed:false,glass:false,reduceEffects:false,revision:0};

export function resolveEffects(preferences:Preferences,environment:{contrast:boolean;motion:boolean}) {
  return {
    material:environment.contrast||!preferences.glass?'solid':preferences.reduceEffects?'frosted':'liquid',
    reducedMotion:environment.contrast||environment.motion,
  } as const;
}

export function normalizePreferences(value:unknown):Preferences|null {
  if(!value||typeof value!=='object')return null;
  const p=value as Record<string,unknown>;
  if(!THEMES.some(t=>t.id===p.theme)||typeof p.mode!=='string'||!['system','light','dark'].includes(p.mode))return null;
  if(typeof p.collapsed!=='boolean'||(p.glass!==undefined&&typeof p.glass!=='boolean'))return null;
  if(p.reduceEffects!=null&&typeof p.reduceEffects!=='boolean')return null;
  const revision=p.revision??0;
  if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0)return null;
  return {theme:revision===0?'quota':p.theme as ThemeId,mode:p.mode as ColorMode,collapsed:p.collapsed,glass:p.glass===true,reduceEffects:p.reduceEffects as boolean??p.glass===true,revision};
}

export function newerPreferences(current:Preferences,value:unknown):Preferences {
  const next=normalizePreferences(value);
  return next&&next.revision>=current.revision?next:current;
}
