/** Bounded inward refraction at a rounded surface's bevel. No content is copied. */
export function lensDisplacement(x:number,y:number,width:number,height:number,radius:number) {
  const r=Math.min(radius,width/2,height/2),px=x-width/2,py=y-height/2;
  if(!Number.isFinite(r)||r<=0)return {x:0,y:0};
  const qx=Math.abs(px)-width/2+r,qy=Math.abs(py)-height/2+r;
  const ax=Math.max(qx,0),ay=Math.max(qy,0),length=Math.hypot(ax,ay);
  const distance=length+Math.min(Math.max(qx,qy),0)-r;
  if(distance>0)return {x:0,y:0};
  const bevel=Math.min(14,r),t=Math.min(1,-distance/bevel);
  const bend=(1-t)**2*(.35+1.5*Math.sin(Math.PI*t));
  const nx=length>0?ax/length:qx>qy?1:0,ny=length>0?ay/length:qy>=qx?1:0;
  return {x:-Math.sign(px)*nx*bend,y:-Math.sign(py)*ny*bend};
}

export function lensMap(width:number,height:number,radius:number) {
  const scale=Math.min(1,768/Math.max(width,height));
  const w=Math.max(2,Math.round(width*scale)),h=Math.max(2,Math.round(height*scale));
  const pixels=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const d=lensDisplacement((x+.5)*width/w,(y+.5)*height/h,width,height,radius),i=(y*w+x)*4;
    pixels[i]=Math.round(127.5+d.x*127.5);pixels[i+1]=Math.round(127.5+d.y*127.5);pixels[i+2]=128;pixels[i+3]=255;
  }
  return {width:w,height:h,pixels};
}
