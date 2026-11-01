//! Fail closed: only known official table schemas and exact model IDs are eligible.
use std::collections::HashMap;
use crate::model::ModelPrice;

fn amount(text:&str,currency:char)->Option<f64>{
    text.trim().strip_prefix(currency)?.parse::<f64>().ok().filter(|n|n.is_finite()&&*n>=0.0)
}
pub fn openai(markdown:&str)->HashMap<String,ModelPrice>{
    openai_tier(markdown,"Standard",false)
}
pub fn openai_tier(markdown:&str,tier:&str,long:bool)->HashMap<String,ModelPrice>{
    let mut result=HashMap::new();
    if long&&!markdown.contains("Short context: ≤272K input tokens. Long context: >272K input tokens."){return result}
    for (id,header,cells) in openai_rows(markdown,tier){
        let column=|field:&str|header.iter().position(|value|value==field);
        let context=if long{"Long context"}else{"Short context"};
        let input=column(&format!("{context} input")).or_else(||if long{None}else{column("Input")});
        let output=column(&format!("{context} output")).or_else(||if long{None}else{column("Output")});
        let (Some(input),Some(output))=(input.and_then(|i|amount(&cells[i],'$')),output.and_then(|i|amount(&cells[i],'$')))else{continue};
        let cached=column(&format!("{context} cached input")).or_else(||if long{None}else{column("Cached input")}).and_then(|i|amount(&cells[i],'$'));
        let write=|ttl:&str|column(&format!("{context} {ttl} write")).and_then(|i|amount(&cells[i],'$'));
        let context=if long{"单次输入超过 272K Token"}else{"基础输入档；长输入加价档另列"};
        let p=ModelPrice{currency:"USD".into(),unit:"每百万 tokens".into(),input:Some(input),output:Some(output),cached_input:cached,cache_write:write("5m"),cache_write_long:write("1h"),note:Some(format!("官方自动核实 · OpenAI {tier} · {context}。缓存写入按保留时长另计。"))};
        if result.insert(id,p).is_some(){return HashMap::new()}
    }
    result
}
fn openai_rows(markdown:&str,tier:&str)->Vec<(String,Vec<String>,Vec<String>)>{
    if !markdown.contains("Prices per 1M tokens."){return vec![]}
    let marker=format!("### {tier} pricing data");
    let Some(section)=markdown.split(&marker).nth(1)else{return vec![]};
    let mut header:Vec<String>=Vec::new();let mut rows=Vec::new();
    for line in section.split("### ").next().unwrap_or(section).lines(){
        if !line.trim().starts_with('|'){continue}
        let cells:Vec<String>=line.trim().trim_matches('|').split('|').map(|s|s.trim().to_string()).collect();
        if cells.first().is_some_and(|s|s=="Model"){
            if cells.iter().collect::<std::collections::HashSet<_>>().len()!=cells.len(){return vec![]}
            header=cells;continue
        }
        if cells.len()!=header.len()||cells.is_empty(){continue}
        let id=cells[0].strip_suffix(" (<272K context length)").unwrap_or(&cells[0]);
        if !(id.starts_with("gpt-")||id.starts_with("chatgpt-")||id.starts_with("codex-")||matches!(id,"o1"|"o1-pro"|"o3"|"o3-pro"|"o4-mini"|"o3-mini")){continue}
        rows.push((id.into(),header.clone(),cells));
    }rows
}
#[derive(Clone,serde::Serialize,serde::Deserialize)]
#[serde(rename_all="camelCase")]
pub struct CacheWrite {pub ttl_seconds:u32,pub price:f64}
pub fn cache_writes(vendor:&str,body:&str)->HashMap<String,Vec<CacheWrite>>{
    let mut out=HashMap::new();
    if matches!(vendor,"Kimi"|"Anthropic"){
        for(id,price)in parse(vendor,body){let values:Vec<_>=[(300,price.cache_write),(3600,price.cache_write_long)].into_iter().filter_map(|(ttl,price)|price.map(|price|CacheWrite{ttl_seconds:ttl,price})).collect();if !values.is_empty(){out.insert(key(&id),values);}}
        return out
    }
    if vendor!="OpenAI"{return out}
    for (id,header,cells) in openai_rows(body,"Standard"){
        let values:Vec<_>=[("5m",300),("30m",1800),("1h",3600),("12h",43200)].into_iter().filter_map(|(label,ttl)|{
            let column=header.iter().position(|s|s==&format!("Short context {label} write"))?;
            Some(CacheWrite{ttl_seconds:ttl,price:amount(&cells[column],'$')?})
        }).collect();if !values.is_empty(){out.insert(key(&id),values);}
    }out
}
pub fn kimi(markdown:&str)->HashMap<String,ModelPrice>{
    let mut result=HashMap::new();
    for table in markdown.split("<DocTable").skip(1){
        let Some(table)=table.split("/>").next()else{continue};
        let Some((columns,rows))=table.split_once("rows={[")else{continue};
        let headings:Vec<_>=columns.lines().filter_map(|l|l.split_once("title: \"").and_then(|(_,v)|v.split('"').next())).collect();
        let k3=["模型","计费单位","缓存写入（TTL 5min）","缓存写入（TTL 1h）","输入价格（缓存命中）","输入价格（缓存未命中）","输出价格","上下文窗口"];
        let k2=["模型","计费单位","输入价格（缓存命中）","输入价格（缓存未命中）","输出价格","上下文窗口"];
        let (hit,input,output)=if headings==k3{(4,5,6)}else if headings==k2{(2,3,4)}else{continue};
        for row in rows.lines(){
            let row=row.trim().trim_end_matches(',');if !row.starts_with("[\""){continue}
            let Ok(cells)=serde_json::from_str::<Vec<String>>(row)else{continue};
            if cells.len()!=headings.len()||cells[1]!="1M tokens"||!cells[0].starts_with("kimi-"){continue}
            let (Some(i),Some(o))=(amount(&cells[input],'¥'),amount(&cells[output],'¥'))else{continue};
            let p=ModelPrice{currency:"CNY".into(),unit:"每百万 tokens".into(),input:Some(i),output:Some(o),cached_input:amount(&cells[hit],'¥'),cache_write:if headings==k3{amount(&cells[2],'¥')}else{None},cache_write_long:if headings==k3{amount(&cells[3],'¥')}else{None},note:Some("官方自动核实 · 标准档非缓存".into())};
            if result.insert(cells[0].clone(),p).is_some(){return HashMap::new()}
        }
    }
    if result.is_empty(){return kimi_static(markdown)}
    result
}
// Mintlify omits client tables from Markdown. Read only fixed literal DocTable
// props from the official HTML; never evaluate MDX or page JavaScript.
fn kimi_static(body:&str)->HashMap<String,ModelPrice>{
    let mut out=HashMap::new();
    if !body.contains("https://platform.kimi.com/docs/pricing/chat") || !body.contains("MTok"){return out}
    for table in body.split("DocTable,{").skip(1){
        let Some((_,columns))=table.split_once("columns:[")else{continue};
        let Some((columns,rows))=columns.split_once("],rows:[")else{continue};
        let labels=if columns.matches("width:").count()==6{vec!["模型","输入","输出","缓存命中","缓存写入（5min）","缓存写入（1h）"]}
            else if columns.matches("width:").count()==4{vec!["模型","输入","输出","缓存命中"]}else{continue};
        let mut at=0;let mut valid=true;
        for label in &labels{let plain=format!("title:`{label}`");let child=format!("children:`{label}`");
            match columns[at..].find(&plain).map(|next|(next,plain.len())).or_else(||columns[at..].find(&child).map(|next|(next,child.len()))){Some((next,len))=>at+=next+len,None=>{valid=false;break}}
        }
        if !valid{continue}
        for row in rows.split("]})").next().unwrap_or(rows).split("[_jsx(").skip(1){
            let Some(id)=row.split("children:`").nth(1).and_then(|s|s.split('`').next()).filter(|id|id.starts_with("kimi-")&&id.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'-'|'.')))else{continue};
            let Some(prices)=row.split_once("}),").map(|(_,s)|s.split(']').next().unwrap_or(s))else{continue};
            let values:Vec<_>=prices.split('`').enumerate().filter_map(|(i,s)|if i%2==1{Some(s)}else{None}).collect();
            if values.len()!=labels.len()-1{continue}
            let rate=|i:usize|values.get(i).and_then(|s|s.strip_suffix(" / MTok")).and_then(|s|amount(s,'¥'));
            if let(Some(input),Some(output))=(rate(0),rate(1)){
                let p=ModelPrice{currency:"CNY".into(),unit:"每百万 tokens".into(),input:Some(input),output:Some(output),cached_input:rate(2),cache_write:if labels.len()==6{rate(3)}else{None},cache_write_long:if labels.len()==6{rate(4)}else{None},note:Some("官方自动核实 · Kimi 标准实时推理；按人民币每百万 Token 计费。缓存写入时长另列。".into())};
                if out.insert(id.to_string(),p).is_some(){return HashMap::new()}
            }
        }
    }out
}

pub const SOURCES: &[(&str,&str)] = &[
 ("OpenAI","https://developers.openai.com/api/docs/pricing.md"),
 ("Kimi","https://platform.kimi.com/docs/pricing/chat.md"),
 ("Anthropic","https://platform.claude.com/docs/en/about-claude/pricing.md"),
 ("DeepSeek","https://api-docs.deepseek.com/quick_start/pricing/"),
 ("Z AI","https://docs.bigmodel.cn/cn/guide/start/pricing.md"),
 ("Google","https://ai.google.dev/gemini-api/docs/pricing"),
 ("Xiaomi","https://mimo.mi.com/docs/price/pay-as-you-go"),
 ("Alibaba","https://help.aliyun.com/zh/model-studio/model-pricing"),
 ("SpaceXAI","https://docs.x.ai/developers/pricing"),
 ("Meta","https://dev.meta.ai/docs/pricing-rate-limits")];
pub fn key(id:&str)->String {id.chars().filter(|c|c.is_ascii_alphanumeric()).flat_map(char::to_lowercase).collect()}
// Anthropic's price table uses product names; its documented API versioning
// uses hyphens: https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions
pub fn api_id(vendor:&str,id:&str)->String{if vendor=="Anthropic"&&id.starts_with("claude-"){id.replace('.',"-")}else{id.into()}}
pub fn parse(vendor:&str,body:&str)->HashMap<String,ModelPrice>{
 use crate::official_tables::*;
 match vendor {"OpenAI"=>openai(body),"Kimi"=>kimi(body),"Anthropic"=>anthropic(body),"DeepSeek"=>deepseek(body),"Z AI"=>zhipu(body),"Google"=>google(body),"Xiaomi"=>xiaomi(body),"Alibaba"=>alibaba(body),"SpaceXAI"=>xai(body),"Meta"=>meta(body),_=>HashMap::new()}
}
#[derive(Clone,serde::Serialize,serde::Deserialize)]
pub struct PriceOption {pub id:String,pub label:String,pub price:ModelPrice}
pub struct Check {pub prices:HashMap<String,ModelPrice>,pub model_ids:HashMap<String,String>,pub cache_writes:HashMap<String,Vec<CacheWrite>>,pub off_peak:HashMap<String,ModelPrice>,pub options:HashMap<String,Vec<PriceOption>>,pub source:String,pub error:Option<String>}
pub fn price_options(vendor:&str,body:&str)->HashMap<String,Vec<PriceOption>> {
 let mut result:HashMap<String,Vec<PriceOption>>=HashMap::new();
 let tiers=match vendor {
  "Anthropic"=>vec![("long","输入超过 10 万",crate::official_tables::anthropic_context(body,true)),("batch","异步批量",crate::official_tables::anthropic_batch(body,false)),("batch-long","批量 · 输入超过 10 万",crate::official_tables::anthropic_batch(body,true))],
  "DeepSeek"=>vec![("off-peak","闲时半价",crate::official_tables::deepseek_band(body,true))],
  "Google"=>vec![("batch","异步批量",crate::official_tables::google_tier(body,"Batch")),("flex","弹性服务",crate::official_tables::google_tier(body,"Flex"))],
  "Xiaomi"=>vec![("batch","异步批量",crate::official_tables::xiaomi_tier(body,true))],
  "OpenAI"=>vec![("batch","异步批量",openai_tier(body,"Batch",false)),("flex","弹性服务",openai_tier(body,"Flex",false)),("long","输入超过 272K",openai_tier(body,"Standard",true)),("batch-long","批量 · 输入超过 272K",openai_tier(body,"Batch",true)),("flex-long","弹性 · 输入超过 272K",openai_tier(body,"Flex",true))],
  _=>vec![],
 };
 for(id,label,prices)in tiers {for(model,price)in prices{result.entry(key(&model)).or_default().push(PriceOption{id:id.into(),label:label.into(),price});}}
 result
}
async fn download_http(client:&reqwest::Client,url:&str)->Result<String,String>{
 let mut response=client.get(url).header(reqwest::header::USER_AGENT,"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36").timeout(std::time::Duration::from_secs(25)).send().await.map_err(|e|if e.is_timeout(){"官网连接超时"}else{"官网连接失败"})?;
 if !response.status().is_success(){return Err(format!("官网返回 HTTP {}",response.status().as_u16()))}
 let mut bytes=Vec::new();while let Some(chunk)=response.chunk().await.map_err(|_|"官网读取失败")? {if bytes.len()+chunk.len()>6*1024*1024{return Err("官网页面超出安全读取范围".into())}bytes.extend_from_slice(&chunk)}
 String::from_utf8(bytes).map_err(|_|"官网编码发生变化".into())
}
// Native system networking can differ from reqwest on Windows and macOS.
// Only public vendor documents/resources are allowed; no app data or credentials are passed.
async fn download(client:&reqwest::Client,url:&str)->Result<String,String>{
 let result=download_http(client,url).await;
 if result.is_ok(){return result}
 #[cfg(windows)] {
  let known=SOURCES.iter().any(|(_,source)|*source==url||source.trim_end_matches(".md")==url)||url.strip_prefix("https://mimo.mi.com/static/").is_some_and(|path|path.ends_with(".chunk.js")&&path.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'.'|'-')));
  if known {let url=url.to_string();if let Ok(Ok(body))=tauri::async_runtime::spawn_blocking(move||native_document(&url)).await{return Ok(body)}}
 }
 #[cfg(target_os="macos")] {
  let known=SOURCES.iter().any(|(_,source)|*source==url||source.trim_end_matches(".md")==url)||url.strip_prefix("https://mimo.mi.com/static/").is_some_and(|path|path.ends_with(".chunk.js")&&path.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'.'|'-')));
  if known {let url=url.to_string();if let Ok(Ok(body))=tauri::async_runtime::spawn_blocking(move||macos_document(&url)).await{return Ok(body)}}
 }
 result
}
#[cfg(target_os="macos")]
fn macos_document(url:&str)->Result<String,String>{
 let mut command=std::process::Command::new("/usr/bin/curl");
 command.args(["--disable","--fail","--location","--max-redirs","3","--proto","=https","--proto-redir","=https","--max-time","20","--max-filesize","6291456","--silent"]);
 if let Some(proxy)=crate::proxy::system_proxy_url(){command.args(["--proxy",&proxy]);}
 let output=command.arg(url).output().map_err(|_|"系统网络读取不可用")?;
 if !output.status.success()||output.stdout.len()>6*1024*1024{return Err("系统网络读取失败".into())}
 String::from_utf8(output.stdout).map_err(|_|"官网响应编码无效".into())
}
#[cfg(windows)]
fn native_document(url:&str)->Result<String,String>{
 use std::os::windows::process::CommandExt;
 use base64::Engine;
 let script=format!("$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$r=Invoke-WebRequest -UseBasicParsing -Uri '{url}' -UserAgent 'Mozilla/5.0' -TimeoutSec 20;if($r.StatusCode -ne 200){{exit 1}};$s=[string]$r.Content;$b=[Text.Encoding]::UTF8.GetBytes($s);if($b.Length -gt 6291456){{exit 1}};[Console]::Write([Convert]::ToBase64String($b))");
 let output=std::process::Command::new("powershell.exe").args(["-NoLogo","-NoProfile","-NonInteractive","-Command",&script]).creation_flags(0x08000000).output().map_err(|_|"系统网络读取不可用")?;
 if !output.status.success()||output.stdout.len()>8*1024*1024{return Err("系统网络读取失败".into())}
 let bytes=base64::engine::general_purpose::STANDARD.decode(&output.stdout).map_err(|_|"系统网络响应编码无效")?;
 String::from_utf8(bytes).map_err(|_|"官网响应编码无效".into())
}
// Read static documentation data without executing vendor JavaScript.
async fn xiaomi_document(client:&reqwest::Client,html:&str)->Result<String,String>{
 let hash=|id:&str|->Option<String>{html.split(&format!("{id}:\"")).nth(1)?.split('"').next().filter(|s|s.len()==16&&s.chars().all(|c|c.is_ascii_hexdigit())).map(str::to_string)};
 let main=hash("4270").ok_or("小米文档资源结构变化")?;
 let main=download(client,&format!("https://mimo.mi.com/static/main.{main}.chunk.js")).await?;
 let route=main.split("path:\"zh-CN/price/pay-as-you-go\"").nth(1).and_then(|s|s.split(".then(").next()).ok_or("小米定价路径变化")?;
 let id=route.rsplit(".e(").next().and_then(|s|s.split(')').next()).filter(|s|s.chars().all(|c|c.is_ascii_digit())).ok_or("小米定价资源变化")?;
 let chunk=hash(id).ok_or("小米定价资源版本缺失")?;
 let js=download(client,&format!("https://mimo.mi.com/static/{id}.{chunk}.chunk.js")).await?;
 let raw=js.split("html:'").nth(1).and_then(|s|s.split("',").next()).ok_or("小米定价内容结构变化")?;
 // HTML stored as a JS single-quoted string: only the known escapes are accepted.
 let mut output=String::new();let mut chars=raw.chars();while let Some(c)=chars.next(){if c=='\\'{match chars.next(){Some('n')=>output.push('\n'),Some('r')=>output.push('\r'),Some('t')=>output.push('\t'),Some('\\')=>output.push('\\'),Some('\'')=>output.push('\''),Some('"')=>output.push('"'),_=>return Err("小米文档转义格式变化".into())}}else{output.push(c)}}Ok(output)
}
pub async fn fetch(client:&reqwest::Client)->HashMap<String,Check>{
 let limiter=std::sync::Arc::new(tokio::sync::Semaphore::new(4));
 let tasks:Vec<_>=SOURCES.iter().map(|&(vendor,url)|{let client=client.clone();let limiter=limiter.clone();tauri::async_runtime::spawn(async move{
  let _permit=limiter.acquire_owned().await.ok();
  let result=async{let body=download(&client,url).await?;let mut body=if vendor=="Xiaomi"{xiaomi_document(&client,&body).await?}else{body};let mut parsed=parse(vendor,&body);
   if parsed.is_empty()&&vendor=="Kimi"{body=download(&client,url.trim_end_matches(".md")).await?;parsed=parse(vendor,&body);}
   if parsed.is_empty(){return Err("官网定价表结构变化或暂无可自动确认的标准 Token 价格".into())}let offers=if vendor=="DeepSeek"{crate::official_tables::deepseek_band(&body,true)}else{HashMap::new()};let options=price_options(vendor,&body);let writes=cache_writes(vendor,&body);Ok((parsed,offers,options,writes))}.await;
  let (prices,offers,options,writes,mut error)=match result{Ok((prices,offers,options,writes))=>(prices,offers,options,writes,None),Err(e)=>(HashMap::new(),HashMap::new(),HashMap::new(),HashMap::new(),Some(e))};
  let mut normalized=HashMap::new();let mut model_ids=HashMap::new();for(id,p)in prices{let k=key(&id);model_ids.insert(k.clone(),api_id(vendor,&id));if normalized.insert(k,p).is_some(){normalized.clear();model_ids.clear();error=Some("官方型号归一化出现冲突，已停止采用该来源".into());break}}
  let mut off_peak=HashMap::new();for(id,p)in offers{let k=key(&id);if off_peak.insert(k,p).is_some(){off_peak.clear();break}}
  (vendor.into(),Check{prices:normalized,model_ids,cache_writes:writes,off_peak,options,source:url.trim_end_matches(".md").into(),error})
 })}).collect();
 let mut results=HashMap::new();for task in tasks{if let Ok((vendor,check))=task.await{results.insert(vendor,check);}}results
}
