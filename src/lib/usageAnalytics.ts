import type {ActivityGroup,VendorExpense,CostObservation,MonthlyUsageRate} from './types';
import {convertedExpense} from './usageCny';

export type UsageGrain='day'|'week'|'month';
export interface UsageBucket {from:string;to:string;label:string;subscription:number;usage:number;tokens:number;hasCost:boolean;hasSubscription:boolean;hasUsage:boolean;missingFx?:boolean}
export const dayNumber=(value:string)=>{const [year,month,day]=value.split('-').map(Number);return Date.UTC(year,month-1,day)/86400000;};
export const dayText=(value:number)=>new Date(value*86400000).toISOString().slice(0,10);
export const localDay=(value=new Date())=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
export function usageBuckets(expenses:VendorExpense[],daily:ActivityGroup[],from:string,to:string,grain:UsageGrain,currency:string,vendor='',rates:MonthlyUsageRate[]=[]){
  const today=localDay();
  const records=expenses.filter(row=>(!vendor||row.vendor===vendor)&&(currency==='RMB'||row.currency===currency)&&row.from<=today&&row.from<=to&&row.to>=from&&(row.subscription!=null||row.usage!=null));
  const starts=[...daily.map(row=>row.key),...records.map(row=>row.from)].filter(Boolean).sort();
  const ends=[today,...daily.map(row=>row.key),...records.map(row=>row.to)].filter(Boolean).sort();
  const first=from==='1900-01-01'?(starts[0]??today):from,last=to==='9999-12-31'?(ends[ends.length-1]??today):to;
  let cursor=dayNumber(first),end=dayNumber(last);
  if(!Number.isFinite(cursor)||!Number.isFinite(end)||cursor>end)return {buckets:[] as UsageBucket[],error:'请选择有效的统计日期'};
  const buckets:UsageBucket[]=[];
  while(cursor<=end&&buckets.length<800){
    const date=new Date(cursor*86400000);
    const limit=grain==='day'?cursor:grain==='week'?cursor+(7-(date.getUTCDay()+6)%7)-1:Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)/86400000;
    const finish=Math.min(limit,end),startDay=dayText(cursor),endDay=dayText(finish);
    const bucket:UsageBucket={from:startDay,to:endDay,label:grain==='month'?startDay.slice(0,7):startDay.slice(5),subscription:0,usage:0,tokens:0,hasCost:false,hasSubscription:false,hasUsage:false};
    for(const row of records){
      const overlap=Math.min(dayNumber(row.to),finish)-Math.max(dayNumber(row.from),cursor)+1;
      const length=dayNumber(row.to)-dayNumber(row.from)+1;
      if(overlap<=0||length<=0)continue;
      if(currency==='RMB'){
        const converted=convertedExpense(row,startDay,endDay,rates);
        bucket.missingFx ||= converted.missingMonths.length>0;
        bucket.subscription+=converted.subscription??0;bucket.usage+=converted.usage??0;
      }else{bucket.subscription+=(row.subscription??0)*overlap/length;bucket.usage+=(row.usage??0)*overlap/length;}
      bucket.hasCost=true;
      bucket.hasSubscription ||= row.subscription!=null;bucket.hasUsage ||= row.usage!=null;
    }
    bucket.tokens=daily.filter(row=>row.key>=startDay&&row.key<=endDay).reduce((sum,row)=>sum+row.tokens.total,0);
    buckets.push(bucket);cursor=finish+1;
  }
  if(cursor<=end)return {buckets:[] as UsageBucket[],error:'当前日期范围过大，请改为按月或缩短范围'};
  return {buckets,error:''};
}
export function filteredObservations(rows:CostObservation[],vendor:string,currency:string,search:string){
  const query=search.trim().toLowerCase();
  return rows.filter(row=>(!vendor||row.vendor===vendor)&&row.currency===currency&&(!query||`${row.label} ${row.vendor} ${localDay(new Date(row.at*1000))}`.toLowerCase().includes(query))).sort((a,b)=>b.at-a.at||a.accountId.localeCompare(b.accountId));
}
export function reportCsv(columns:string[],rows:(string|number|null|undefined)[][]){
  const cell=(value:string|number|null|undefined)=>{let text=value==null?'':String(value);if(typeof value==='string'&&/^\s*[=+@\-]|^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  return '\uFEFF'+[columns,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
