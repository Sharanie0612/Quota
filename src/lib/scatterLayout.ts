export type PlotNode={id:string;x:number;y:number;cost:number;score:number};
/** Group visually touching points without moving any price or score coordinate. */
export function scatterClusters<T extends PlotNode>(points:T[],spacing=28){
  const parent=points.map((_,i)=>i);
  const root=(i:number):number=>parent[i]===i?i:(parent[i]=root(parent[i]));
  for(let i=0;i<points.length;i++)for(let j=0;j<i;j++)if(Math.hypot(points[i].x-points[j].x,points[i].y-points[j].y)<spacing)parent[root(i)]=root(j);
  const groups=new Map<number,T[]>();
  points.forEach((point,i)=>{const key=root(i);groups.set(key,[...(groups.get(key)??[]),point]);});
  return [...groups.values()].map(members=>{
    // A real member nearest its neighbours anchors the badge; no averaged data point.
    const distance=(a:T)=>members.reduce((sum,b)=>sum+Math.hypot(a.x-b.x,a.y-b.y),0);
    const anchor=[...members].sort((a,b)=>distance(a)-distance(b)||a.id.localeCompare(b.id))[0];
    return {anchor,members};
  });
}
export function plotPriceLabel(price:number,currency:string){
  const value=price>0&&price<.0001?price.toExponential(2):price.toLocaleString('zh-CN',{maximumFractionDigits:price<1?4:2});
  return `${currency==='CNY'?'¥':currency==='USD'?'$':currency+' '}${value}`;
}
