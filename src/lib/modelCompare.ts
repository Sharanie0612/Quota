import type { AiModel, ModelPrice } from './types';
export function modelOffer(model:AiModel,tier:string):ModelPrice|null{return tier==='standard'?model.price:model.priceOptions.find(option=>option.id===tier)?.price??null;}
export function estimateModel(price:ModelPrice|null,input:number,output:number,cachedPercent:number):number|null{
  if(!price||![input,output,cachedPercent].every(Number.isFinite)||input<0||output<0||input>1e12||output>1e12||cachedPercent<0||cachedPercent>100)return null;
  if(price.input==null||price.output==null||cachedPercent>0&&price.cachedInput==null)return null;
  if([price.input,price.output,price.cachedInput].some(value=>value!=null&&(!Number.isFinite(value)||value<0)))return null;
  const hit=cachedPercent/100;
  return (input*(1-hit)*price.input+input*hit*(price.cachedInput??0)+output*price.output)/1e6;
}
