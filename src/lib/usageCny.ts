import type {MonthlyUsageRate,VendorExpense} from './types';
import {expensePortions} from './vendorCosts';

export const cny=(value:number|null|undefined)=>value==null?'—':`¥${value.toLocaleString('zh-CN',{maximumFractionDigits:2})}`;
export function convertedExpense(expense:VendorExpense,from:string,to:string,rates:MonthlyUsageRate[]){
  const portions=expensePortions(expense,from,to);
  const known=expense.subscription!=null||expense.usage!=null;
  const missingMonths=expense.currency==='USD'&&((expense.subscription??0)+(expense.usage??0))>0
    ?portions.filter(p=>!rates.some(rate=>rate.month===p.month&&Number.isFinite(rate.cnyPerUsd)&&rate.cnyPerUsd>0)).map(p=>p.month):[];
  const multiplier=expense.currency==='CNY'?portions.reduce((sum,p)=>sum+p.factor,0)
    :portions.reduce((sum,p)=>sum+p.factor*(rates.find(rate=>rate.month===p.month)?.cnyPerUsd??0),0);
  const subscription=!known||missingMonths.length||expense.subscription==null?null:expense.subscription*multiplier;
  const usage=!known||missingMonths.length||expense.usage==null?null:expense.usage*multiplier;
  const total=!known||missingMonths.length?null:(subscription??0)+(usage??0);
  return {subscription,usage,total,missingMonths};
}
export function convertedSnapshot(value:number|null,currency:string,month:string,rates:MonthlyUsageRate[]){
  if(value==null||!Number.isFinite(value))return null;
  if(currency==='CNY'||value===0)return value;
  const rate=rates.find(row=>row.month===month);return rate?value*rate.cnyPerUsd:null;
}
