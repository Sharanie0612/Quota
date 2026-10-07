import type { LadderEntry } from "./types";
export type LadderMetric = "total" | "input" | "output";
export type LadderExchange = { cnyPerUsd: number; date: string; error: string | null };
export const plotBounds = { left: 62, right: 842, top: 44, bottom: 500 };

/** Only explicit Token units can share the per-million price axis. */
export function tokenUnitMultiplier(unit: string): number | null {
  const value = unit.replace(/\s+/g, "").toLowerCase();
  if (["每百万tokens", "每百万token", "每1mtokens", "每1mtoken", "per1mtokens"].includes(value)) return 1;
  if (["每千tokens", "每千token", "每1ktokens", "每1ktoken", "per1ktokens"].includes(value)) return 1000;
  return null;
}
export function comparisonPrice(entry: LadderEntry, metric: LadderMetric): number | null {
  const factor = tokenUnitMultiplier(entry.price.unit);
  const values = metric === "input" ? [entry.price.input] : metric === "output" ? [entry.price.output] : [entry.price.input, entry.price.output];
  if (factor == null || values.some(value => value == null || !Number.isFinite(value) || value < 0)) return null;
  const value = values.reduce<number>((sum, price) => sum + price!, 0) * factor;
  return Number.isFinite(value) ? value : null;
}
export function validExchange(exchange: LadderExchange | null | undefined): exchange is LadderExchange {
  return !!exchange && Number.isFinite(exchange.cnyPerUsd) && exchange.cnyPerUsd > 0;
}
export function plotPrice(entry: LadderEntry, metric: LadderMetric, currency: string, exchange?: LadderExchange | null): number | null {
  const price = comparisonPrice(entry, metric);
  if (price == null) return null;
  const converted = entry.price.currency === currency ? price
    : currency === "CNY" && entry.price.currency === "USD" && validExchange(exchange) ? price * exchange.cnyPerUsd
    : currency === "USD" && entry.price.currency === "CNY" && validExchange(exchange) ? price / exchange.cnyPerUsd : null;
  return converted != null && Number.isFinite(converted) ? converted : null;
}
/** Fit both axes to the current data, without jittering or dropping models. */
export function ladderScale(points: { cost: number; score: number }[]) {
  const valid=points.filter(p=>Number.isFinite(p.cost)&&p.cost>=0&&Number.isFinite(p.score)&&p.score>=0&&p.score<=100);
  const costs=valid.map(p=>p.cost), scores=valid.map(p=>p.score);
  const lowCost=costs.length?Math.min(...costs):0, highCost=costs.length?Math.max(...costs):1;
  const positives=costs.filter(cost=>cost>0);
  const threshold=Math.max(Number.MIN_VALUE,positives.length?Math.min(...positives)/10:1);
  const hasZero=lowCost===0;
  // A scale-relative offset keeps free models visible without compressing sub-yuan prices.
  const transform=(value:number)=>hasZero?(value<=threshold?Math.log1p(value/threshold):Math.log(value)+Math.log1p(threshold/value)-Math.log(threshold)):Math.log(Math.max(Number.MIN_VALUE,value));
  const inverse=(value:number)=>hasZero?Math.exp(Math.min(Math.log(Number.MAX_VALUE),Math.log(threshold)+value))*(-Math.expm1(-value)):Math.exp(Math.min(Math.log(Number.MAX_VALUE),value));
  const lo=transform(lowCost),hi=transform(highCost);
  const padding=hi>lo?Math.max(.000001,(hi-lo)*.06):.12;
  const lower=hasZero?0:Math.max(Math.log(Number.MIN_VALUE),lo-padding);
  const upper=Math.min(hasZero?transform(Number.MAX_VALUE):Math.log(Number.MAX_VALUE),Math.max(hi+padding,lower+.000001));
  const minCost=inverse(lower),max=inverse(upper);
  const x=(value:number)=>plotBounds.left+(transform(value)-lower)/(upper-lower)*(plotBounds.right-plotBounds.left);
  const lowScore=scores.length?Math.min(...scores):0,highScore=scores.length?Math.max(...scores):100;
  const scorePadding=Math.max(.5,(highScore-lowScore)*.06);
  const rawMin=Math.max(0,lowScore-scorePadding),rawMax=Math.min(100,highScore+scorePadding);
  const targetStep=Math.max(.1,(rawMax-rawMin)/6);
  const base=10**Math.floor(Math.log10(targetStep));
  const step=[1,2,5,10].map(n=>n*base).find(n=>n>=targetStep)!;
  const edgeStep=step/5;
  const min=Math.max(0,Math.floor(rawMin/edgeStep)*edgeStep),maxScore=Math.min(100,Math.ceil(rawMax/edgeStep)*edgeStep);
  const y=(value:number)=>plotBounds.bottom-(value-min)/(maxScore-min)*(plotBounds.bottom-plotBounds.top);
  const scoreTicks=[Number(min.toFixed(8))];
  for(let value=Math.ceil(min/step)*step;value<maxScore;value+=step){
    const tick=Number(value.toFixed(8));
    if(y(scoreTicks[scoreTicks.length-1])-y(tick)>32)scoreTicks.push(tick);
  }
  if(y(scoreTicks[scoreTicks.length-1])-y(maxScore)>32)scoreTicks.push(Number(maxScore.toFixed(8)));
  else if(scoreTicks.length>1)scoreTicks[scoreTicks.length-1]=Number(maxScore.toFixed(8));
  const ticks:number[]=[minCost];
  for(let exponent=-323;exponent<=308;exponent++)for(const multiple of [1,2,5]){
    const value=multiple*10**exponent;
    if(Number.isFinite(value)&&value>minCost&&value<max&&x(value)-x(ticks[ticks.length-1])>64)ticks.push(value);
  }
  if(x(max)-x(ticks[ticks.length-1])>64)ticks.push(max);else if(ticks.length>1)ticks[ticks.length-1]=max;else ticks.push(max);
  return {max,min,minCost,maxScore,x,y,ticks,scoreTicks};
}
