/** Monotone cubic interpolation: passes through observations without adding
 * observations or overshooting adjacent extrema. Gaps are split by the caller. */
export function smoothPath(points:{x:number;y:number}[]){
  if(!points.length)return '';
  if(points.length===1)return `M${points[0].x},${points[0].y}`;
  const widths=points.slice(1).map((p,i)=>Math.max(.001,p.x-points[i].x));
  const slopes=points.slice(1).map((p,i)=>(p.y-points[i].y)/widths[i]);
  const tangents=points.map((_,i)=>i===0?slopes[0]:i===points.length-1?slopes[slopes.length-1]:slopes[i-1]*slopes[i]<=0?0:(3*(widths[i-1]+widths[i]))/((2*widths[i]+widths[i-1])/slopes[i-1]+(widths[i]+2*widths[i-1])/slopes[i]));
  for(let i=0;i<slopes.length;i++){
    if(slopes[i]===0){tangents[i]=0;tangents[i+1]=0;continue;}
    const a=tangents[i]/slopes[i],b=tangents[i+1]/slopes[i],norm=Math.hypot(a,b);
    if(norm>3){const scale=3/norm;tangents[i]=scale*a*slopes[i];tangents[i+1]=scale*b*slopes[i];}
  }
  return `M${points[0].x},${points[0].y}`+points.slice(1).map((point,i)=>`C${points[i].x+widths[i]/3},${points[i].y+tangents[i]*widths[i]/3} ${point.x-widths[i]/3},${point.y-tangents[i+1]*widths[i]/3} ${point.x},${point.y}`).join('');
}
