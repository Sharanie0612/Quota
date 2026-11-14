export type PlotNode={id:string;x:number;y:number;cost:number;score:number};

type LabelBox = { left: number; right: number; top: number; bottom: number };
type ChartBounds = LabelBox;
type LabelPoint = PlotNode & { name: string };

function overlaps(a: LabelBox, b: LabelBox) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Move only labels. The dot and leader both start at the measured coordinate. */
export function placeScatterLabels(points: LabelPoint[], bounds: ChartBounds, preferred: Set<string>) {
  const positions = new Map<string, { x: number; y: number; left: number; width: number; label: string; leader: boolean }>();
  const obstacles = points.map(point => ({
    left: point.x - 7, right: point.x + 7, top: point.y - 7, bottom: point.y + 7,
  }));
  const ordered = [...points].sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id))
    || b.score - a.score || a.cost - b.cost || a.id.localeCompare(b.id));
  const alternate = [-30, 30, -48, 48, -66, 66, -84, 84, -102, 102, -120, 120];
  for (const point of ordered) {
    const label = point.name.length > 29 ? point.name.slice(0, 28) + "…" : point.name;
    const width = Math.min(200, [...label].reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 13 : 7.1), 0) + 8);
    const right = point.x + 10, left = point.x - width - 10;
    const center = point.x - width / 2;
    const options = [
      [right, point.y], [left, point.y], [center, point.y - 17], [center, point.y + 17],
      [right, point.y - 16], [left, point.y - 16], [right, point.y + 16], [left, point.y + 16],
      [center, point.y - 33], [center, point.y + 33], [right + 10, point.y - 29], [left - 10, point.y + 29],
      [right + 18, point.y + 34], [left - 18, point.y - 34],
      ...alternate.flatMap(offset => [
        [right + 16, point.y + offset], [left - 16, point.y + offset], [center, point.y + offset],
      ]),
    ];
    for (const [x, y] of options) {
      const leftEdge = Math.min(bounds.right - width, Math.max(bounds.left, x));
      const box = { left: leftEdge, right: leftEdge + width, top: y - 8.5, bottom: y + 8.5 };
      if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom
        || obstacles.some(obstacle => overlaps(box, obstacle))) continue;
      positions.set(point.id, {
        left: leftEdge, width, y, label,
        x: Math.min(box.right, Math.max(box.left, point.x)),
        leader: Math.abs(y - point.y) > 8 || Math.min(Math.abs(box.left - point.x), Math.abs(box.right - point.x)) > 15,
      });
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
