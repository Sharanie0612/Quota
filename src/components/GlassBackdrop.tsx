/** A real layer behind the translucent surfaces; no canvas captures or OS data. */
export function GlassBackdrop(){
  return <div className="glass-backdrop" aria-hidden="true"><i/><i/><i/></div>;
}
