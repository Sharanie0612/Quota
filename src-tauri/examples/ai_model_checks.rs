use quota_lib::{ai_models, official_prices};
use std::collections::HashMap;
fn main() {
    let current="Prices per 1M tokens.\n### Standard pricing data\n| Model | Short context output | Short context input | Short context cached input | Short context 30m write | Short context 12h write |\n| --- | --- | --- | --- | --- | --- |\n| gpt-registry-fixture-new | $10 | $2 | $0.1 | $2.5 | $5 |\n";
    let p = official_prices::openai(current);
    assert_eq!(p["gpt-registry-fixture-new"].input, Some(2.));
    assert_eq!(p["gpt-registry-fixture-new"].output, Some(10.));
    assert_eq!(p["gpt-registry-fixture-new"].cache_write, None);
    assert_eq!(p["gpt-registry-fixture-new"].cache_write_long, None);
    let writes = official_prices::cache_writes("OpenAI", current);
    assert_eq!(
        writes["gptregistryfixturenew"]
            .iter()
            .map(|p| p.ttl_seconds)
            .collect::<Vec<_>>(),
        vec![1800, 43200]
    );
    assert!(official_prices::openai(&current.replace("1M tokens", "1K tokens")).is_empty());
    assert!(
        official_prices::openai(&current.replace("Short context input", "Changed input"))
            .is_empty()
    );
    let kimi = r#"https://platform.kimi.com/docs/pricing/chat MTok DocTable,{columns:[{title:`模型`,width:`25%`},{title:`输入`,width:`13%`},{title:`输出`,width:`13%`},{title:_jsx(Tooltip,{children:`缓存命中`}),width:`14%`},{title:_jsx(Tooltip,{children:`缓存写入（5min）`}),width:`18%`},{title:_jsx(Tooltip,{children:`缓存写入（1h）`}),width:`17%`}],rows:[[_jsx(_components.a,{children:`kimi-k3.1-pro`}),`¥13.00 / MTok`,`¥68.00 / MTok`,`¥1.30 / MTok`,`¥13.00 / MTok`,`¥26.00 / MTok`]]})"#;
    let price = official_prices::kimi(kimi);
    assert_eq!(price["kimi-k3.1-pro"].input, Some(13.));
    assert_eq!(price["kimi-k3.1-pro"].cache_write_long, Some(26.));
    assert!(official_prices::kimi(&kimi.replace(" / MTok", " / KTok")).is_empty());
    assert!(
        official_prices::kimi(&kimi.replace("缓存写入（5min）", "缓存写入（30min）")).is_empty()
    );
    println!("PASS semantic column ordering, new exact model discovery, cache TTL separation, official static Kimi table and unit/schema drift rejection");
    let mut checks = HashMap::new();
    checks.insert(
        "OpenAI".into(),
        official_prices::Check {
            model_ids: p
                .keys()
                .map(|id| (official_prices::key(id), id.clone()))
                .collect(),
            prices: p
                .into_iter()
                .map(|(id, p)| (official_prices::key(&id), p))
                .collect(),
            cache_writes: writes,
            off_peak: HashMap::new(),
            options: HashMap::new(),
            source: "https://developers.openai.com/api/docs/pricing".into(),
            error: None,
        },
    );
    let seed = ai_models::load(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/no-registry-fixture"),
    );
    let first = ai_models::merge(seed, &checks, "2026-10-28T00:00:00Z");
    let model = first
        .models
        .iter()
        .find(|m| m.api_id == "gpt-registry-fixture-new")
        .unwrap();
    assert_eq!(model.context, None);
    assert!(model.abilities.is_empty());
    checks.get_mut("OpenAI").unwrap().prices.clear();
    checks.get_mut("OpenAI").unwrap().error = Some("synthetic offline".into());
    let retained = ai_models::merge(first, &checks, "2026-10-28T00:01:00Z");
    let model = retained
        .models
        .iter()
        .find(|m| m.api_id == "gpt-registry-fixture-new")
        .unwrap();
    assert_eq!(model.price.as_ref().unwrap().input, Some(2.));
    assert!(model.issue.is_some());
    assert_eq!(model.verified_at.as_deref(), Some("2026-10-28T00:00:00Z"));
    println!("PASS registry independent of AITier, official-only identity, unknown capabilities preserved and offline last-good retention");
    if std::env::args().any(|a| a == "--live") {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async{
            let mut builder=reqwest::Client::builder();if let Some(proxy)=quota_lib::system_proxy_url(){builder=builder.proxy(reqwest::Proxy::all(proxy).unwrap());}
            let checks=official_prices::fetch(&builder.build().unwrap()).await;
            for(v,c)in &checks{println!("LIVE {v}: {} verified models; {:?}",c.prices.len(),c.error);}
            let seed=ai_models::load(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/no-registry-fixture"));
            let snapshot=ai_models::merge(seed,&checks,&chrono::Utc::now().to_rfc3339());
            let body=serde_json::to_vec_pretty(&snapshot).unwrap();
            let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
            std::fs::create_dir_all(root.join("../target")).unwrap();std::fs::write(root.join("../target/ai-models-live.json"),&body).unwrap();
            assert_eq!(checks.len(),official_prices::SOURCES.len(),"all official tasks must finish");
            assert!(checks.values().all(|c|!c.prices.is_empty()&&c.error.is_none()),"not all official providers passed; report retained");
            let mut ladder=quota_lib::load_ladder(&root.join("target/no-registry-fixture"));
            ai_models::apply_to_ladder(&mut ladder,&snapshot);
            let official=snapshot.models.iter().find(|m|m.api_id=="gpt-6.1-sol").unwrap();
            let reference=ladder.entries.iter().find(|e|e.id=="gpt-6-1-sol-high").or_else(||ladder.entries.iter().find(|e|e.id=="gpt-6-1-sol")).unwrap();
            assert_eq!(reference.price.input,official.price.as_ref().unwrap().input);
            assert_eq!(reference.verified_at,official.verified_at);
            println!("PASS packaged official registry hydrates legacy benchmark prices before any network refresh");
            if std::env::args().any(|a|a=="--write-seed"){std::fs::write(root.join("data/ai-models.json"),body).unwrap();}
        });
    }
}
