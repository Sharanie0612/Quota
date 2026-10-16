use quota_lib::official_prices;
fn main(){
 let openai=include_str!("../data/pricing-fixtures/openai-tiers.txt");
 let options=official_prices::price_options("OpenAI",openai);
 let sol=&options["gpt61sol"];
 assert_eq!(sol.iter().find(|p|p.id=="batch").unwrap().price.input,Some(1.));
 assert_eq!(sol.iter().find(|p|p.id=="flex").unwrap().price.input,Some(1.));
 assert_eq!(sol.iter().find(|p|p.id=="long").unwrap().price.output,Some(15.));
 assert_eq!(sol.iter().find(|p|p.id=="batch-long").unwrap().price.output,Some(7.5));
 assert!(official_prices::openai_tier(&openai.replace("Long context: >272K","Long context: >300K"),"Standard",true).is_empty());
 assert!(official_prices::openai_tier(&openai.replace("Short context input","Changed input"),"Batch",false).is_empty());
 let xiaomi=official_prices::price_options("Xiaomi",include_str!("../data/pricing-fixtures/xiaomi-html.txt"));
 assert_eq!(xiaomi["mimov26pro"][0].price.input,Some(1.5));
 assert!(!xiaomi.contains_key("mimov26proultraspeed"));
 let tiers=include_str!("../data/pricing-fixtures/anthropic-tiers.txt");
 let prices=official_prices::parse("Anthropic",tiers);
 assert_eq!(prices["claude-haiku-5.5"].input,Some(0.10));
 let options=official_prices::price_options("Anthropic",tiers);
 let haiku=&options["claudehaiku55"];
 assert_eq!(haiku.iter().find(|p|p.id=="long").unwrap().price.input,Some(0.50));
 assert_eq!(haiku.iter().find(|p|p.id=="batch").unwrap().price.input,Some(0.05));
 assert_eq!(haiku.iter().find(|p|p.id=="batch-long").unwrap().price.output,Some(1.25));
 assert_eq!(haiku.iter().find(|p|p.id=="batch").unwrap().price.cached_input,Some(0.005));
 assert!(!official_prices::parse("Anthropic",&tiers.replace("up to 100,000","up to 200,000")).contains_key("claude-haiku-5.5"));
 assert!(quota_lib::official_tables::anthropic_batch(&tiers.replace("50% discount","40% discount"),false).is_empty());
 let argon=include_str!("../data/pricing-fixtures/google-argon.html");
 let prices=official_prices::parse("Google",argon);
 let before=chrono::Utc::now().date_naive()<=chrono::NaiveDate::from_ymd_opt(2026,11,30).unwrap();
 assert_eq!(prices["gemini-4-argon"].input,Some(if before{2.}else{4.}));
 assert_eq!(prices["gemini-4-argon"].cached_input,Some(if before{0.1}else{0.2}));
 let options=official_prices::price_options("Google",argon);
 assert_eq!(options["gemini4argon"].iter().find(|p|p.id=="batch").unwrap().price.input,Some(if before{1.}else{2.}));
 assert!(official_prices::parse("Google",&argon.replace("December 1, 2026","December 3, 2026")).is_empty());
 let meta=official_prices::parse("Meta",include_str!("../data/pricing-fixtures/meta-current.html"));
 assert_eq!(meta["muse-wonder-1.0"].input,Some(4.));
 assert_eq!(meta["muse-spark-1.3"].input,Some(1.25));
 assert!(!meta.contains_key("muse-spark-1.3-contributor"));
 println!("PASS Haiku context and Batch separation, Google dated policies and Meta current schema");
 let body=include_str!("../data/pricing-fixtures/deepseek-en.html");
 let standard=official_prices::parse("DeepSeek",body);
 let discount=quota_lib::official_tables::deepseek_band(body,true);
 assert_eq!(standard["deepseek-flash"].input,Some(0.3));
 assert_eq!(discount["deepseek-flash"].input,Some(0.15));
 assert_eq!(discount["deepseek-v4-pro-0813"].output,Some(1.98));
 assert!(quota_lib::official_tables::deepseek_band(&body.replace("excluding Chinese public holidays","including Chinese public holidays"),true).is_empty());
 assert!(official_prices::parse("DeepSeek",&body.replace("1M INPUT TOKENS","1K INPUT TOKENS")).is_empty());
 assert!(quota_lib::official_tables::deepseek_band(&body.replace("$0.15","$0.16"),true).get("deepseek-flash").is_none());
 println!("PASS DeepSeek exact model, standard and conditional half-price, changed policy/unit/rate rejection");
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
  runtime.block_on(async {let mut builder=reqwest::Client::builder();if let Some(url)=quota_lib::system_proxy_url(){builder=builder.proxy(reqwest::Proxy::all(url).unwrap());}let client=builder.build().unwrap();let checks=official_prices::fetch(&client).await;for(v,c)in &checks{println!("Live {v}: {} {:?}",c.prices.len(),c.error);}
   if std::env::args().any(|a|a=="--report") {
    let report:std::collections::BTreeMap<_,_>=checks.iter().map(|(v,c)|(v,serde_json::json!({"prices":c.prices,"options":c.options,"offPeak":c.off_peak,"source":c.source,"error":c.error}))).collect();
    let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/official-live-report.json");
    std::fs::write(path,serde_json::to_vec_pretty(&serde_json::json!({"checkedAt":chrono::Utc::now().to_rfc3339(),"vendors":report})).unwrap()).unwrap();
   }
   assert_eq!(checks.len(),10);assert!(checks["Xiaomi"].prices.contains_key("mimov26pro"));});
 }
}
