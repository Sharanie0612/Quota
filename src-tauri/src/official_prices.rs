//! Fail closed: only known official table schemas and exact model IDs are eligible.
use std::collections::HashMap;
use crate::model::ModelPrice;

fn amount(text:&str,currency:char)->Option<f64>{
    text.trim().strip_prefix(currency)?.parse::<f64>().ok().filter(|n|n.is_finite()&&*n>=0.0)
}
pub fn openai(markdown:&str)->HashMap<String,ModelPrice>{
    let mut result=HashMap::new();
    let Some(section)=markdown.split("### Standard pricing data").nth(1)else{return result};
    let section=section.split("### ").next().unwrap_or(section);
    let header="| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |";
    if !markdown.contains("Prices per 1M tokens.")||!section.contains(header){return result}
    for line in section.lines(){
        let cells:Vec<_>=line.trim().trim_matches('|').split('|').map(str::trim).collect();
        if cells.len()!=9 {continue}
        let id=cells[0].strip_suffix(" (<272K context length)").unwrap_or(cells[0]);
        if !id.starts_with("gpt-")&&!matches!(id,"o1"|"o1-pro"|"o3"|"o3-pro"|"o4-mini"|"o3-mini"){continue}
        let (Some(input),Some(output))=(amount(cells[1],'$'),amount(cells[4],'$'))else{continue};
        // The table does not specify write TTL; do not mislabel a generic write rate as 5min.
        let p=ModelPrice{currency:"USD".into(),unit:"每百万 tokens".into(),input:Some(input),output:Some(output),cached_input:amount(cells[2],'$'),note:Some("官方自动核实 · Standard 短上下文；缓存写入 TTL 未明确".into()),..Default::default()};
        if result.insert(id.into(),p).is_some(){return HashMap::new()}
    }
    result
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
    result
}

pub const SOURCES: &[(&str,&str)] = &[
 ("OpenAI","https://developers.openai.com/api/docs/pricing.md"),
 ("Kimi","https://platform.kimi.com/docs/pricing/chat.md"),
 ("Anthropic","https://platform.claude.com/docs/en/about-claude/pricing.md"),
 ("DeepSeek","https://api-docs.deepseek.com/zh-cn/quick_start/pricing"),
 ("Z AI","https://docs.bigmodel.cn/cn/guide/start/pricing.md"),
 ("Google","https://ai.google.dev/gemini-api/docs/pricing"),
 ("Xiaomi","https://mimo.mi.com/docs/price/pay-as-you-go"),
 ("Alibaba","https://help.aliyun.com/zh/model-studio/model-pricing"),
 ("SpaceXAI","https://docs.x.ai/developers/pricing"),
 ("Meta","https://dev.meta.ai/docs/pricing-rate-limits")];
pub fn key(id:&str)->String {id.chars().filter(|c|c.is_ascii_alphanumeric()).flat_map(char::to_lowercase).collect()}
pub fn parse(vendor:&str,body:&str)->HashMap<String,ModelPrice>{
 use crate::official_tables::*;
 match vendor {"OpenAI"=>openai(body),"Kimi"=>kimi(body),"Anthropic"=>anthropic(body),"DeepSeek"=>deepseek(body),"Z AI"=>zhipu(body),"Google"=>google(body),"Xiaomi"=>xiaomi(body),"Alibaba"=>alibaba(body),"SpaceXAI"=>xai(body),"Meta"=>meta(body),_=>HashMap::new()}
}
pub struct Check {pub prices:HashMap<String,ModelPrice>,pub source:String,pub error:Option<String>}
async fn download_http(client:&reqwest::Client,url:&str)->Result<String,String>{
 let mut response=client.get(url).header(reqwest::header::USER_AGENT,"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36").timeout(std::time::Duration::from_secs(25)).send().await.map_err(|e|if e.is_timeout(){"官网连接超时"}else{"官网连接失败"})?;
 if !response.status().is_success(){return Err(format!("官网返回 HTTP {}",response.status().as_u16()))}
 let mut bytes=Vec::new();while let Some(chunk)=response.chunk().await.map_err(|_|"官网读取失败")? {if bytes.len()+chunk.len()>6*1024*1024{return Err("官网页面超出安全读取范围".into())}bytes.extend_from_slice(&chunk)}
 String::from_utf8(bytes).map_err(|_|"官网编码发生变化".into())
}
// Windows' native HTTP stack follows system networking that can differ from reqwest.
// Only public vendor documents/resources are allowed; no app data or credentials are passed.
async fn download(client:&reqwest::Client,url:&str)->Result<String,String>{
 let result=download_http(client,url).await;
 if result.is_ok(){return result}
 #[cfg(windows)] {
  let known=SOURCES.iter().any(|(_,source)|*source==url)||url.strip_prefix("https://mimo.mi.com/static/").is_some_and(|path|path.ends_with(".chunk.js")&&path.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'.'|'-')));
  if known {let url=url.to_string();if let Ok(Ok(body))=tauri::async_runtime::spawn_blocking(move||native_document(&url)).await{return Ok(body)}}
 }
 result
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
  let result=async{let body=download(&client,url).await?;let body=if vendor=="Xiaomi"{xiaomi_document(&client,&body).await?}else{body};let parsed=parse(vendor,&body);if parsed.is_empty(){return Err("官网定价表结构变化或暂无可自动确认的标准 Token 价格".into())}Ok(parsed)}.await;
  let (prices,error)=match result{Ok(prices)=>(prices,None),Err(e)=>(HashMap::new(),Some(e))};
  let mut normalized=HashMap::new();for(id,p)in prices{let k=key(&id);if normalized.insert(k,p).is_some(){normalized.clear();break}}
  (vendor.into(),Check{prices:normalized,source:url.trim_end_matches(".md").into(),error})
 })}).collect();
 let mut results=HashMap::new();for task in tasks{if let Ok((vendor,check))=task.await{results.insert(vendor,check);}}results
}
