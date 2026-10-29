import type {vendorRows} from '../lib/vendorCosts';
import type {VendorExpense} from '../lib/types';
import {cny} from '../lib/usageCny';
import {ModelLogo} from './ModelLogo';
import {ProviderLogo} from './logos';
import {IconWallet} from './icons';
import {Button,EmptyState} from './ui';

export function ActualUsagePrices({rows,onRecord,onEdit}:{rows:ReturnType<typeof vendorRows>;onRecord:(vendor:string)=>void;onEdit:(record:VendorExpense)=>void}){
  return <section className="usage-prices">
    {rows.length?rows.map(row=><details className="card vendor-cost-card" key={row.id}>
      <summary className="vendor-cost-head"><div className="vendor-cost-brand"><ProviderLogo provider={row.id==='custom'?'openai':row.id} size={28}/><b>{row.name}</b></div><div><span>支出</span><b>{cny(row.cny)}</b></div><div><span>费用覆盖 Token</span><b>{row.covered.total.toLocaleString('zh-CN')}</b></div><div><span>实际单价 / 百万 Token</span><b>{cny(row.cnyEffective)}</b></div></summary>
      <div className="vendor-cost-body">
        <div className="usage-analysis-heading"><h3>模型用量</h3><Button size="sm" onClick={()=>onRecord(row.id)}>记录支出</Button></div>
        <div className="usage-cost-scroll"><table className="vendor-model-table"><thead><tr><th>模型</th><th>Token</th><th>输入 / 输出</th><th>缓存命中</th><th>占比</th></tr></thead><tbody>{row.families.map(family=><tr key={family.key}><td><div className="usage-cost-model"><ModelLogo name={family.key} size={22}/><span title={family.variants.map(v=>v.key).join('、')}>{family.key}</span></div></td><td>{family.tokens.total.toLocaleString('zh-CN')}</td><td>{family.tokens.input.toLocaleString('zh-CN')} / {family.tokens.output.toLocaleString('zh-CN')}</td><td>{family.tokens.cached.toLocaleString('zh-CN')}</td><td>{row.totals.total?(family.tokens.total/row.totals.total*100).toFixed(1)+'%':'—'}</td></tr>)}</tbody></table></div>
        {!!row.allExpenses.length&&<div className="vendor-expense-list">{row.allExpenses.map(expense=><div key={`${expense.from}-${expense.to}-${expense.currency}`}><span>{expense.from} — {expense.to}</span><span>{expense.currency==='USD'?'$':'¥'}{((expense.subscription??0)+(expense.usage??0)).toLocaleString('zh-CN')} {expense.currency}</span><Button size="sm" variant="quiet" onClick={()=>onEdit(expense)}>编辑</Button></div>)}</div>}
      </div>
    </details>):<section className="card"><EmptyState icon={<IconWallet size={24}/>} title="还没有用量与支出" action={<Button onClick={()=>onRecord('custom')}>记录支出</Button>}/></section>}
  </section>;
}
