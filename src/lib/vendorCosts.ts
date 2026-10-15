import { activityModelIdentity } from "./activityModels";
import type { ActivityGroup, ActivityTokens, VendorCostReport, VendorExpense, MonthlyUsageRate } from "./types";

const dateNumber=(s:string)=>{const [y,m,d]=s.split('-').map(Number);return Date.UTC(y,m-1,d)/86400000;};
const dateText=(n:number)=>new Date(n*86400000).toISOString().slice(0,10);
export function expensePortions(e:VendorExpense,from:string,to:string){
  const start=Math.max(dateNumber(e.from),dateNumber(from)),end=Math.min(dateNumber(e.to),dateNumber(to));
  const days=dateNumber(e.to)-dateNumber(e.from)+1;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||days<=0)return [];
  const portions:{month:string;factor:number}[]=[];
  let n=start;
  while(n<=end&&portions.length<600){const d=new Date(n*86400000);const last=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)/86400000;const finish=Math.min(last,end);portions.push({month:dateText(n).slice(0,7),factor:(finish-n+1)/days});n=finish+1;}
  if(n<=end)return []; // Never claim a complete conversion after truncation.
  return portions;
}

export const vendorNames: Record<string,string> = {custom:"OpenAI / ChatGPT",deepseek:"DeepSeek",mimo:"小米 MiMo",moonshot:"Kimi",zhipu:"智谱 GLM",anthropic:"Anthropic",google:"Google",alibaba:"Alibaba",unknown:"其他 / 未识别"};
export const emptyTokens = (): ActivityTokens => ({input:0,output:0,cached:0,cacheWrite:0,reasoning:0,total:0});
export function sumTokens(rows:ActivityGroup[]) {
  return rows.reduce((total,row)=>{for(const key of Object.keys(total) as (keyof ActivityTokens)[])total[key]+=row.tokens[key];return total;},emptyTokens());
}
export function effectiveVendorPrice(amount:number|null,total:number) {
  return amount!=null&&Number.isFinite(amount)&&amount>=0&&Number.isFinite(total)&&total>0?amount*1e6/total:null;
}
export function modelFamilies(rows:ActivityGroup[]) {
  const families=new Map<string,ActivityGroup[]>();
  for(const row of rows){const family=row.key.replace(/-(?:xhigh|high|medium|low|max|non-reasoning)$/i,"");families.set(family,[...(families.get(family)??[]),row]);}
  return [...families].map(([key,variants])=>({key,variants,tokens:sumTokens(variants)})).sort((a,b)=>b.tokens.total-a.tokens.total);
}
export function vendorRows(models:ActivityGroup[],report:VendorCostReport,from:string,to:string,rates:MonthlyUsageRate[]=[]) {
  const groups=new Map<string,ActivityGroup[]>();
  for(const row of models){const id=activityModelIdentity(row.key).provider;groups.set(id,[...(groups.get(id)??[]),row]);}
  const ids=new Set([...groups.keys(),...report.accounts.map(a=>a.vendor),...report.expenses.filter(e=>e.from<=to&&e.to>=from).map(e=>e.vendor)]);
  return [...ids].map(id=>{
    const rows=groups.get(id)??[];
    const allExpenses=report.expenses.filter(e=>e.vendor===id&&e.from<=to&&e.to>=from);
    const now=new Date();const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const expenses=allExpenses.filter(e=>e.from<=today&&expensePortions(e,from,to).length>0);
    const currencies=[...new Set(expenses.map(e=>e.currency))];
    const covered=sumTokens(report.coveredModels[id]??[]);
    const totals=sumTokens(rows);
    const amounts=currencies.map(currency=>{
      const entries=expenses.filter(e=>e.currency===currency);
      const factor=(e:VendorExpense)=>expensePortions(e,from,to).reduce((n,p)=>n+p.factor,0);
      const subscription=entries.reduce((n,e)=>n+(e.subscription??0)*factor(e),0);
      const usage=entries.reduce((n,e)=>n+(e.usage??0)*factor(e),0);
      const currencyTokens=sumTokens(report.coveredModels[`${id}:${currency}`]??[]).total;
      const parts=entries.flatMap(e=>expensePortions(e,from,to).map(p=>({...p,amount:((e.subscription??0)+(e.usage??0))*p.factor})));
      const missingMonths=currency==='USD'?[...new Set(parts.filter(p=>p.amount!==0&&!rates.some(r=>r.month===p.month)).map(p=>p.month))]:[];
      const cny=missingMonths.length?null:currency==='CNY'?subscription+usage:parts.reduce((n,p)=>n+p.amount*(rates.find(r=>r.month===p.month)?.cnyPerUsd??0),0);
      return {currency,subscription,usage,total:subscription+usage,effective:effectiveVendorPrice(subscription+usage,currencyTokens),cny,missingMonths,partial:entries.some(e=>e.from<from||e.to>to)};
    });
    const cny=amounts.some(a=>a.cny==null)||!amounts.length?null:amounts.reduce((n,a)=>n+(a.cny??0),0);
    return {id,name:vendorNames[id]??id,rows,families:modelFamilies(rows),totals,covered,expenses,allExpenses,amounts,cny,cnyEffective:effectiveVendorPrice(cny,covered.total),accounts:report.accounts.filter(a=>a.vendor===id)};
  }).sort((a,b)=>b.totals.total-a.totals.total||a.name.localeCompare(b.name,"zh-CN"));
}
export function endOfSubscription(from:string,months:number) {
  const [year,month,day]=from.split('-').map(Number);
  if(!year||!month||!day)return from;
  const nextLast=new Date(year,month-1+months+1,0).getDate();
  const end=new Date(year,month-1+months,Math.min(day,nextLast));end.setDate(end.getDate()-1);
  return `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
}
