export type WindowKind='main'|'usage-widget'|'setup';

export function resolveWindowKind(search:string):WindowKind {
  const kind=new URLSearchParams(search).get('window');
  return kind==='usage-widget'||kind==='setup'?kind:'main';
}
