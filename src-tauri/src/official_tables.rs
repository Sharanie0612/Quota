use std::collections::HashMap;
use scraper::{Html, Selector, ElementRef};
use crate::model::ModelPrice;
type Prices = HashMap<String, ModelPrice>;
fn sel(s: &str) -> Selector { Selector::parse(s).expect("static selector") }
fn text(e: ElementRef<'_>) -> String { e.text().collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ") }
fn rows(e: ElementRef<'_>) -> Vec<Vec<String>> { e.select(&sel("tr")).map(|r| r.select(&sel("th,td")).map(text).collect()).collect() }
fn num(s:&str)->Option<f64>{s.trim().parse::<f64>().ok().filter(|n|n.is_finite()&&*n>=0.)}
fn dollar(s:&str)->Option<f64>{num(s.trim().strip_prefix('$')?)}
fn price(currency:&str,i:f64,o:f64,hit:Option<f64>,note:&str)->ModelPrice { ModelPrice{currency:currency.into(),unit:"每百万 tokens".into(),input:Some(i),output:Some(o),cached_input:hit,note:Some(format!("官方自动核实 · {note}")),..Default::default()} }
fn markdown_rows(body:&str)->impl Iterator<Item=Vec<&str>> { body.lines().filter(|l|l.starts_with('|')).map(|l|l.trim_matches('|').split('|').map(str::trim).collect()) }
pub fn anthropic(body:&str)->Prices {
 let mut out=Prices::new();let Some(section)=body.split("## Model pricing").nth(1)else{return out};let section=section.split("## Cloud platform pricing").next().unwrap_or(section);
 if !body.contains("All prices are in USD") || !markdown_rows(section).any(|c|c==["Model","Base input tokens","5m cache writes","1h cache writes","Cache hits and refreshes","Output tokens"]) {return out}
 let rate=|s:&str| dollar(s.split(" / MTok").next().unwrap_or(""));
 for c in markdown_rows(section){if c.len()!=6||!c[0].starts_with("Claude ")||c[0].contains("retired"){continue}let id=c[0].split(" (").next().unwrap_or(c[0]).to_lowercase().replace(' ',"-");
  if let (Some(i),Some(o))=(rate(c[1]),rate(c[5])){let mut p=price("USD",i,o,rate(c[4]),"Claude API 标准档；缓存写入分别为 5 分钟 / 1 小时");p.cache_write=rate(c[2]);p.cache_write_long=rate(c[3]);out.insert(id,p);}
 }out
}
pub fn zhipu(body:&str)->Prices {
 let mut out=Prices::new();if !body.contains("元/百万 Tokens"){return out}let mut schema=false;
 for c in markdown_rows(body){if c[0]=="模型名称"{schema=c.get(2).is_some_and(|v|v.contains("输入单价"))&&c.get(3).is_some_and(|v|v.contains("输出单价"))&&c.get(5).is_some_and(|v|v.contains("缓存命中"));continue}
  if !schema||c.len()<6||!c[0].starts_with("GLM-"){continue}let id=c[0].to_lowercase();if out.contains_key(&id){continue}
  // Multi-axis output tiers cannot be represented by one standard token price.
  if c[1].contains("输出长度"){continue}
  let n=|s:&str| if s=="免费"{Some(0.)}else{num(s)};
  if let(Some(i),Some(o))=(n(c[2]),n(c[3])){out.insert(id,price("CNY",i,o,n(c[5]),&format!("标准档；上下文条件：{}；缓存存储不计作写入价",c[1])));}
 }out
}
pub fn deepseek(body:&str)->Prices {
 let mut out=Prices::new();let doc=Html::parse_document(body);
 for t in doc.select(&sel("table")){let r=rows(t);let Some(models)=r.first().filter(|r|r.len()==3&&r[0]=="模型")else{continue};let hits:Vec<_>=r.iter().filter(|r|r.first().is_some_and(|c|c=="高峰时段")&&r.len()==3).collect();
  let full=text(t);if hits.len()!=3||!full.contains("百万tokens输入")||!full.contains("缓存未命中")||!full.contains("百万tokens输出"){continue}
  for col in 1..=2{let n=|row:usize|num(hits[row][col].strip_suffix('元').unwrap_or(""));if let(Some(h),Some(i),Some(o))=(n(0),n(1),n(2)){let p=price("CNY",i,o,Some(h),"标准高峰时段，非闲时折扣");out.insert(models[col].split_whitespace().next().unwrap_or("").into(),p.clone());if let Some(versions)=r.iter().find(|r|r.len()==3&&r[0]=="模型版本"){out.insert(versions[col].to_lowercase(),p);}}}
 }out
}
pub fn xai(body:&str)->Prices {
 let mut out=Prices::new();if !body.contains("All prices are in USD")||!body.contains("Prices per 1M tokens"){return out}let doc=Html::parse_document(body);
 for t in doc.select(&sel("table")){let r=rows(t);if r.first().map(|v|v.join("|"))!=Some("Model|Context|Short context|Long context".into())||r.get(1).map(|v|v.join("|"))!=Some("Input|Cached|Output|Input|Cached|Output".into()){continue}
  for c in r.iter().skip(2){if c.len()!=8{continue}let id=c[0].split_whitespace().next().unwrap_or("");if !id.starts_with("grok-"){continue}if let(Some(i),Some(o))=(dollar(&c[2]),dollar(&c[4])){out.insert(id.into(),price("USD",i,o,dollar(&c[3]),"全球 Text API 标准短上下文 <200K tokens"));}}
 }out
}
pub fn meta(body:&str)->Prices {
 let mut out=Prices::new();let Some(s)=body.split("id=\"standard-tier\"").nth(1)else{return out};let s=s.split("id=\"contributor-tier\"").next().unwrap_or(s);let doc=Html::parse_fragment(s);let Some(t)=doc.select(&sel("table")).next()else{return out};let r=rows(t);
 if r.first().map(|v|v.join("|"))!=Some("Usage|Price per 1M tokens".into()){return out}let get=|key:&str|r.iter().find(|c|c.len()==2&&c[0]==key).and_then(|c|dollar(&c[1]));
 if let(Some(i),Some(o))=(get("Input"),get("Output")){for c in doc.select(&sel("code")){let id=text(c);if id.starts_with("muse-spark-")&&id.split_whitespace().count()==1{out.insert(id,price("USD",i,o,get("Cached input"),"Meta API Standard tier"));}}}out
}
// Accept only explicitly understood textual rates; image/audio and ambiguous cells remain absent.
fn google_rate(s:&str,today:chrono::NaiveDate)->Option<f64>{
 for modality in [" (text / image / video / audio)"," (text / image / video)"] {
  if let Some((rate,rest))=s.split_once(modality){let rest=rest.trim();if rest.is_empty()||rest.strip_suffix(" (audio)").and_then(dollar).is_some(){return dollar(rate)}return None}
 }
 if let Some((current,future))=s.split_once(" through December 31, 2026."){let future=future.trim();let future=future.strip_suffix(" starting January 1, 2027.")?;return if today<=chrono::NaiveDate::from_ymd_opt(2026,12,31)?{dollar(current)}else{dollar(future)}}
 if let Some((short,long))=s.split_once(", prompts <= 200k tokens"){if long.trim().starts_with('$')&&long.contains("prompts > 200k"){return dollar(short)}}
 if let Some((short,long))=s.split_once(", prompts ≤ 200k tokens"){if long.trim().starts_with('$')&&long.contains("prompts > 200k"){return dollar(short)}}
 dollar(s)
}
fn google_cache(s:&str,today:chrono::NaiveDate)->Option<f64>{
 let storage=s.find(" / 1,000,000 tokens per hour (storage price)")?;
 let boundary=s[..storage].rfind('$')?;
 let rate=s[..boundary].trim();
 // Cache-hit bands use the same short-context boundary as standard inputs.
 let rate=rate.replace(", prompts <= 200k $",", prompts <= 200k tokens $").replace(", prompts ≤ 200k $",", prompts ≤ 200k tokens $");
 google_rate(&rate,today)
}
pub fn google(body:&str)->Prices {
 let mut out=Prices::new();let today=chrono::Utc::now().date_naive();
 for chunk in body.split("<div class=\"models-section\">").skip(1){let doc=Html::parse_fragment(chunk);let Some(code)=doc.select(&sel(".heading-group code")).next()else{continue};let id=text(code);if !id.starts_with("gemini-"){continue}
  let Some(section)=doc.select(&sel("section")).find(|s|s.select(&sel("h3")).next().is_some_and(|h|text(h)=="Standard"))else{continue};let Some(t)=section.select(&sel("table")).next()else{continue};let r=rows(t);if !r.first().is_some_and(|c|c.len()==3&&c[2]=="Paid Tier, per 1M tokens in USD"){continue}
  let get=|label:&str|r.iter().find(|c|c.len()==3&&c[0]==label).and_then(|c|google_rate(&c[2],today));
  let cached=r.iter().find(|c|c.len()==3&&c[0]=="Context caching price").and_then(|c|google_cache(&c[2],today));
  if let(Some(i),Some(o))=(get("Input price").or_else(||get("Input price (text, image, video)")),get("Output price (including thinking tokens)")){let p=price("USD",i,o,cached,"Gemini API Standard；文本输入与输出、短上下文，按官网当前生效日期；缓存存储另计");for code in doc.select(&sel(".heading-group code")){let id=text(code);if id.starts_with("gemini-")&&id.split_whitespace().count()==1{out.insert(id,p.clone());}}}
 }out
}
pub fn alibaba(body:&str)->Prices {
 let mut out=Prices::new();let Some(json)=body.split("window.__ICE_PAGE_PROPS__=").nth(1)else{return out};let mut stream=serde_json::Deserializer::from_str(json).into_iter::<serde_json::Value>();let Some(Ok(v))=stream.next()else{return out};let Some(content)=v.pointer("/docDetailData/storeData/data/content").and_then(|v|v.as_str())else{return out};let doc=Html::parse_fragment(content);
 for section in doc.select(&sel("section")){if !section.value().attr("id").is_some_and(|id|id.starts_with("华北2-北京")){continue}
  for t in section.select(&sel("table")){let r=rows(t);let Some(h)=r.first()else{continue};let Some(ic)=h.iter().position(|s|s.replace(' ',"")=="输入单价（每百万Token）")else{continue};let Some(oc)=h.iter().position(|s|s.replace(' ',"").starts_with("输出单价（每百万Token）"))else{continue};
   if !h[0].contains("模型 ID"){continue}
   for c in r.iter().skip(1){if c.len()!=h.len(){continue}let id=c[0].split_whitespace().next().unwrap_or("");if !id.starts_with("qwen")||out.contains_key(id){continue}if !c.iter().any(|s|s.contains("非思考和思考模式")){continue}
    if let(Some(i),Some(o))=(num(c[ic].strip_suffix('元').unwrap_or("")),num(c[oc].strip_suffix('元').unwrap_or(""))){out.insert(id.into(),price("CNY",i,o,None,&format!("华北 2 北京实时推理，非思考/思考同价；{}",c[ic-1])));}
   }
  }
 }out
}
pub fn xiaomi(body:&str)->Prices {
 let mut out=Prices::new();if !body.contains("元 / 百万 tokens"){return out}let doc=Html::parse_fragment(body);let Some(t)=doc.select(&sel("table")).next()else{return out};let r=rows(t);if r.first().map(|v|v.join("|"))!=Some("推理类型|模型名称|输入（命中缓存）|输入（未命中缓存）|输出".into()){return out}
 let mut realtime=false;
 for c in r.iter().skip(1){if c.len()==5{realtime=c[0]=="实时推理"}if !realtime||!(4..=5).contains(&c.len()){continue}let start=c.len()-4;let n=|j:usize|num(c[start+j].strip_prefix('¥').unwrap_or(""));if let(Some(h),Some(i),Some(o))=(n(1),n(2),n(3)){for id in c[start].split('、').map(str::trim){let id=id.split_whitespace().next().unwrap_or("");if id.starts_with("mimo-"){out.insert(id.into(),price("CNY",i,o,Some(h),"国内实时推理标准档；缓存写入限时免费但 TTL 未明确"));}}}
 }out
}
