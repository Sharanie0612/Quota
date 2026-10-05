use quota_lib::official_prices;
fn main(){
 for (vendor,file) in [("OpenAI","openai"),("Kimi","kimi"),("Anthropic","anthropic"),("DeepSeek","deepseek"),("Z AI","zhipu"),("Google","google"),("Alibaba","alibaba"),("SpaceXAI","xai"),("Meta","meta"),("Xiaomi","xiaomi-html")]{
  let body=std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("data/pricing-fixtures/{file}.txt"))).unwrap();
  let prices=official_prices::parse(vendor,&body);
  println!("{vendor}: {} official prices",prices.len());
  assert!(!prices.is_empty(),"no official prices for {vendor}");
  let invalid=match vendor {"OpenAI"=>body.replace("Short context input","Changed input"),"Kimi"=>body.replace("1M tokens","1K tokens"),"Anthropic"=>body.replace("Base input tokens","Changed input"),"DeepSeek"=>body.replace("高峰时段","闲时折扣"),"Z AI"=>body.replace("元/百万 Tokens","元/千 Tokens"),"Google"=>body.replace("per 1M tokens in USD","per 1K tokens in USD"),"Alibaba"=>body.replace("华北2-北京","其他地区"),"SpaceXAI"=>body.replace("All prices are in USD","All prices are in EUR"),"Meta"=>body.replace("Price per 1M tokens","Price per 1K tokens"),"Xiaomi"=>body.replace("实时推理","批量推理"),_=>body.clone()};assert!(official_prices::parse(vendor,&invalid).is_empty(),"schema/unit/tier drift must stop {vendor}");
  if vendor=="Xiaomi"{assert_eq!(prices["mimo-v2.6-pro"].input,Some(3.));assert_eq!(prices["mimo-v2.6-pro"].cached_input,Some(0.025));}
  if vendor=="DeepSeek"{assert_eq!(prices["deepseek-flash"].input,Some(2.));assert_eq!(prices["deepseek-flash"].cached_input,Some(0.04));}
  if vendor=="Anthropic"{assert_eq!(prices["claude-opus-5.5"].input,Some(4.));assert_eq!(prices["claude-opus-5.5"].cache_write_long,Some(8.));}
  if vendor=="Meta"{assert_eq!(prices["muse-spark-1.3"].input,Some(1.25));}
  if vendor=="Google"{assert_eq!(prices["gemini-3.8-flash"].input,Some(if chrono::Utc::now().date_naive() <= chrono::NaiveDate::from_ymd_opt(2026,12,31).unwrap(){0.75}else{1.5}));}
  if vendor=="SpaceXAI"{assert_eq!(prices["grok-4.7"].input,Some(2.));assert_eq!(prices["grok-4.7"].cached_input,Some(0.5));}
 }
 if std::env::args().any(|a|a=="--live"){
  let runtime=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
  runtime.block_on(async {let mut builder=reqwest::Client::builder();if let Some(url)=quota_lib::system_proxy_url(){builder=builder.proxy(reqwest::Proxy::all(url).unwrap());}let client=builder.build().unwrap();let checks=official_prices::fetch(&client).await;for(v,c)in &checks{println!("Live {v}: {} {:?}",c.prices.len(),c.error);}assert_eq!(checks.len(),10);assert!(checks["Xiaomi"].prices.contains_key("mimov26pro"));});
 }
}
