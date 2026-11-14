export type PlotNode={id:string;x:number;y:number;cost:number;score:number};

type LabelBox = { left: number; right: number; top: number; bottom: number };
type ChartBounds = LabelBox;
type LabelPoint = PlotNode & { name: string };

function overlaps(a: LabelBox, b: LabelBox) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Keep reference labels next to their points and clear of the other marks. */
export function placeScatterLabels(points: LabelPoint[], bounds: ChartBounds, references: LabelPoint[]) {
  const positions = new Map<string, { y: number; left: number; width: number; label: string; anchorX: number }>();
  const obstacles = points.map(point => ({
    left: point.x - 7, right: point.x + 7, top: point.y - 7, bottom: point.y + 7,
  }));
  for (const point of references) {
    const label = point.name.length > 42 ? point.name.slice(0, 41) + "…" : point.name;
    const width = [...label].reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 12 : /[ilI., ()1]/.test(char) ? 3.8 : /[MW@]/.test(char) ? 9.6 : 6.1), 0) + 5;
    const right = point.x + 9, left = point.x - width - 9;
    const center = point.x - width / 2;
    const options = [
      [right, point.y], [left, point.y], [center, point.y - 16], [center, point.y + 16],
      [right, point.y - 16], [left, point.y - 16], [right, point.y + 16], [left, point.y + 16],
      [center, point.y - 31], [center, point.y + 31],
    ];
    for (const [x, y] of options) {
      const leftEdge = Math.min(bounds.right - width, Math.max(bounds.left, x));
      const box = { left: leftEdge, right: leftEdge + width, top: y - 7, bottom: y + 7 };
      if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom
        || obstacles.some(obstacle => overlaps(box, obstacle))) continue;
      const anchorX = Math.max(box.left, Math.min(point.x, box.right));
      positions.set(point.id, { left: leftEdge, width, y, label, anchorX });
      obstacles.push(box);
      break;
    }
  }
  return positions;
}
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
