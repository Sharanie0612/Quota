use quota_lib::{activity,official_prices};
use std::fs;
fn main(){
    let openai="Prices per 1M tokens.\n### Standard pricing data\n| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |\n| gpt-6-astra | $10.00 | $1.00 | $12.50 | $50.00 | $20.00 | $2.00 | $25.00 | $75.00 |\n### Batch\n| gpt-6-astra | $5 | $0.5 | $6.25 | $25 | $10 | $1 | $12.50 | $37.50 |";
    let prices=official_prices::openai(openai);assert_eq!(prices.len(),1);let p=&prices["gpt-6-astra"];assert_eq!(p.input,Some(10.));assert_eq!(p.output,Some(50.));assert_eq!(p.cached_input,Some(1.));
    assert!(official_prices::openai(&openai.replace("Short context input","Input")).is_empty());
    assert!(official_prices::openai(&openai.replace("$10.00","$NaN")).is_empty());
    let kimi="<DocTable\ncolumns={[\n{ title: \"模型\" },\n{ title: \"计费单位\" },\n{ title: \"输入价格（缓存命中）\" },\n{ title: \"输入价格（缓存未命中）\" },\n{ title: \"输出价格\" },\n{ title: \"上下文窗口\" },\n]}\nrows={[\n[\"kimi-k2.6\", \"1M tokens\", \"¥1.10\", \"¥6.50\", \"¥27.00\", \"262,144 tokens\"],\n]}\n/>";
    let p=official_prices::kimi(kimi);assert_eq!(p["kimi-k2.6"].input,Some(6.5));assert_eq!(p["kimi-k2.6"].cached_input,Some(1.1));assert!(official_prices::kimi(&kimi.replace("1M tokens","1K tokens")).is_empty());
    let root=std::env::temp_dir().join(format!("quota-cloud-check-{}",uuid::Uuid::new_v4()));fs::create_dir_all(&root).unwrap();
    let a=root.join("a");let b=root.join("b");fs::create_dir_all(&a).unwrap();fs::create_dir_all(&b).unwrap();activity::report(&a,None,None,None).unwrap();activity::report(&b,None,None,None).unwrap();
    let id=activity::options(&a).device_id;let db=rusqlite::Connection::open(a.join("activity.sqlite")).unwrap();
    let event=activity::Metric{id:"1".repeat(64),device:id,source:"codex".into(),session:"synthetic".into(),model:"test".into(),agent:"主 Agent".into(),tool:String::new(),timestamp:1791072000000,kind:"tokens".into(),channel:String::new(),revision:0,tokens:activity::Tokens{input:80,output:20,cached:40,reasoning:5,total:100,..Default::default()}};
    activity::merge_metric(&db,&event,true).unwrap();drop(db);
    let packets=activity::cloud_packets(&a).unwrap();assert_eq!(packets.len(),1);let body=packets[0].1.as_bytes();assert_eq!(activity::import_cloud_packet(&b,body).unwrap(),1);assert_eq!(activity::import_cloud_packet(&b,body).unwrap(),0);assert_eq!(activity::report(&b,None,None,None).unwrap().totals.tokens.total,100);
    assert!(activity::cloud_packets(&b).unwrap().is_empty());assert!(activity::import_cloud_packet(&b,&[0;1024]).is_err());
    let bundle=quota_lib::data_export::activity_data(&a).unwrap();assert_eq!(activity::import_activity_data(&b,&bundle).unwrap(),0);
    let mut corrupt=bundle.clone();let mut bad=serde_json::to_value(&event).unwrap();bad["id"]=serde_json::json!("invalid");corrupt["events"].as_array_mut().unwrap().push(bad);
    assert!(activity::import_activity_data(&b,&corrupt).is_err());assert_eq!(activity::report(&b,None,None,None).unwrap().totals.tokens.total,100);
    println!("PASS exact official schema, standard-vs-batch isolation, currency/cache columns, invalid values, cross-device merge, idempotency, no relay of remote records");
    if std::env::args().any(|a|a=="--official"){
        let openai=fs::read_to_string(".official-openai-pricing.md").unwrap();let kimi=fs::read_to_string(".official-kimi-pricing.md").unwrap();
        let op=official_prices::openai(&openai);let kp=official_prices::kimi(&kimi);assert!(op.contains_key("gpt-6-astra"));assert!(op.contains_key("gpt-6.1-sol"));assert!(kp.contains_key("kimi-k3"));assert!(kp.contains_key("kimi-k2.6"));println!("PASS current official snapshots: {} OpenAI standard models, {} Kimi standard models",op.len(),kp.len());
    }
}
