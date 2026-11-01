// Browser-only synthetic expenses; no personal profile or credentials.
function fixtures(){
  const day=date=>date.toLocaleDateString('sv-SE'),now=new Date(),bills=[],rates={};
  for(let n=0;n<6;n++){
    const from=day(new Date(now.getFullYear(),now.getMonth()-n,1)),to=day(new Date(now.getFullYear(),now.getMonth()-n+1,0));
    rates[from.slice(0,7)]={month:from.slice(0,7),cnyPerUsd:n?7:7.2,date:from.slice(0,7)+'-20',source:'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'};
    for(const [vendor,currency,subscription,usage] of [['custom','USD',20,null],['zhipu','CNY',118,null],['mimo','CNY',39,null],['deepseek','CNY',null,29.5+n*6]])bills.push({vendor,from,to,currency,subscription,usage,planId:null});
  }
  window.demoVendorExpenses=bills;window.demoMonthlyRates=rates;
  window.demoCostHistory=Array.from({length:20},(_,n)=>({accountId:'demo-ledger',label:'开发账户',vendor:'deepseek',currency:'CNY',at:Math.floor(new Date(now.getFullYear(),now.getMonth(),n+1,12).getTime()/1000),from:null,cumulativeSpend:40+n*2,cumulativeRecharge:150,spendDelta:n?2:null,rechargeDelta:n?0:null,counterReset:false}));
}
module.exports={fixtures};
