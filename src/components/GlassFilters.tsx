const map=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="x"><stop stop-color="rgb(30,0,128)"/><stop offset=".16" stop-color="rgb(128,0,128)"/><stop offset=".84" stop-color="rgb(128,0,128)"/><stop offset="1" stop-color="rgb(226,0,128)"/></linearGradient><linearGradient id="y" x2="0" y2="1"><stop stop-color="rgb(0,30,0)"/><stop offset=".16" stop-color="rgb(0,128,0)"/><stop offset=".84" stop-color="rgb(0,128,0)"/><stop offset="1" stop-color="rgb(0,226,0)"/></linearGradient></defs><rect width="256" height="256" fill="url(#x)"/><rect width="256" height="256" fill="url(#y)" style="mix-blend-mode:screen"/></svg>`;
/** A neutral centre keeps content steady; only the lens rim refracts the backdrop. */
export function GlassFilters(){
  return <svg className="glass-filter-defs" aria-hidden="true"><defs><filter id="quota-glass-refraction" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
    <feImage href={`data:image/svg+xml,${encodeURIComponent(map)}`} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="lens"/>
    <feDisplacementMap in="SourceGraphic" in2="lens" scale=".035" xChannelSelector="R" yChannelSelector="G"/>
  </filter></defs></svg>;
}
