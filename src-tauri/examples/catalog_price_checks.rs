//! Executes the production catalog and comparison paths without credentials or network.
use quota_lib::{build_comparison, cards_for_account, comparison_entries, embedded_file, ladder_with_overrides, load_ladder, save_catalog_override, validate_catalog_entry, CatalogEntry, PageScan, RemoteModel};

fn remote(id: &str) -> RemoteModel {
    RemoteModel { id: id.into(), owned_by: None, created: None, description: None, input_limit: None, output_limit: None }
}

fn compare(entry: &CatalogEntry, builtin: Option<&CatalogEntry>) -> serde_json::Value {
    serde_json::to_value(build_comparison("synthetic", &entry.name, "moonshot", entry.price.clone(), entry.verified,
        entry.verified_at.clone(), entry.source.clone(), builtin, None, None)).unwrap()
}

fn main() {
    let catalog = embedded_file().entries;
    for (id, input, hit, output) in [("deepseek-flash", 2.0, 0.04, 8.0), ("deepseek-v4-pro", 9.0, 0.3, 27.0)] {
        let card = &cards_for_account("deepseek", "synthetic", &[remote(id)], &catalog, &[])[0];
        let price = card.price.as_ref().unwrap();
        assert!(card.verified);
        assert_eq!(price.currency, "CNY");
        assert_eq!(price.input, Some(input));
        assert_eq!(price.cached_input, Some(hit));
        assert_eq!(price.output, Some(output));
        assert_eq!(card.source.as_deref(), Some("https://api-docs.deepseek.com/zh-cn/quick_start/pricing"));
        if id == "deepseek-flash" { assert!(card.abilities.contains(&"视觉".into()) && card.abilities.contains(&"推理".into())); }
    }
    println!("PASS DeepSeek current official peak prices, cache fields and Flash capabilities");
    for (id, input, hit, output) in [
        ("glm-5.3", 8.0, Some(2.0), 28.0), ("glm-5.3-flash", 0.8, Some(0.23), 2.8),
        ("glm-5.3-flashx", 2.0, Some(0.57), 7.0), ("glm-5.1", 6.0, Some(1.3), 24.0),
        ("glm-5-turbo", 5.0, Some(1.2), 22.0), ("glm-4.7", 2.0, Some(0.4), 8.0),
        ("glm-4.7-flash", 0.0, Some(0.0), 0.0), ("glm-4.6v-flashx", 0.15, Some(0.03), 1.5),
        ("glm-ocr", 0.2, None, 0.2), ("glm-4v-flash", 0.0, None, 0.0),
    ] {
        let card = &cards_for_account("zhipu", "synthetic", &[remote(id)], &catalog, &[])[0];
        assert!(card.verified); let price = card.price.as_ref().unwrap();
        assert_eq!(price.input, Some(input)); assert_eq!(price.cached_input, hit); assert_eq!(price.output, Some(output));
        assert!(price.cache_write.is_none() && price.cache_write_long.is_none());
    }
    let unknown = &cards_for_account("zhipu", "synthetic", &[remote("glm-4.6")], &catalog, &[])[0];
    assert!(!unknown.verified); let price = unknown.price.as_ref().unwrap();
    assert!(price.input.is_none() && price.output.is_none() && price.cached_input.is_none());
    let turbo = catalog.iter().find(|e| e.r#match == ["glm-5-turbo"]).unwrap();
    assert!(turbo.price.as_ref().unwrap().note.as_ref().unwrap().contains("输入长度 ≥32K"));
    println!("PASS GLM official cache tiers, unsupported cache, free models and unknown output excluded");
    for (provider, id, hit, write, long) in [
        ("moonshot", "kimi-k3", 2.0, Some(20.0), Some(40.0)),
        ("moonshot", "kimi-k2.7-code", 1.3, None, None),
        ("moonshot", "kimi-k2.7-code-highspeed", 2.6, None, None),
        ("moonshot", "kimi-k2.6", 1.1, None, None),
        ("mimo", "mimo-v2.6-pro-ultraspeed", 0.25, Some(0.0), None),
    ] {
        let cards = cards_for_account(provider, "synthetic", &[remote(id)], &catalog, &[]);
        let card = &cards[0];
        assert!(card.verified);
        assert_eq!(card.match_quality, "exact");
        let p = card.price.as_ref().unwrap();
        assert_eq!(p.currency, "CNY");
        assert_eq!(p.cached_input, Some(hit));
        assert_eq!(p.cache_write, write);
        assert_eq!(p.cache_write_long, long);
        let cmp = build_comparison(id, &card.name, provider, card.price.clone(), card.verified,
            card.verified_at.clone(), card.source.clone(), None, None, None);
        let source = cmp.suggested_source.as_ref().unwrap();
        assert_eq!(source.url, card.source.as_deref().unwrap());
        assert!(source.url.starts_with("https://"));
        assert_eq!(source.cached_input, Some(hit));
        assert_eq!(source.cache_write, write);
        assert_eq!(source.cache_write_long, long);
        assert_eq!(cmp.suggested.as_ref().unwrap().cached_input, Some(hit));
        let payload = serde_json::to_value(&cmp).unwrap();
        assert_eq!(payload["suggestedSource"]["cachedInput"], hit);
        assert_eq!(payload["suggestedSource"]["cacheWrite"], serde_json::json!(write));
    }
    println!("PASS five official cache prices, zero write fee and comparison serialization");

    let highspeed = catalog.iter().find(|e| e.r#match.contains(&"kimi-k2.7-code-highspeed".into())).unwrap().clone();
    let cards = cards_for_account("moonshot", "synthetic", &[remote("kimi-k2.7-code")], &catalog, &[highspeed]);
    assert_eq!(cards[0].price.as_ref().unwrap().input, Some(6.5));
    let cards = cards_for_account("moonshot", "synthetic", &[remote("kimi-k2.7-code-unreleased")], &catalog, &[]);
    assert!(cards[0].price.is_none());
    assert!(!cards[0].verified);
    assert_eq!(cards[0].name, "kimi-k2.7-code-unreleased");
    let unknown = build_comparison("unknown", "unknown", "moonshot", None, false, None, None, None, None, None);
    assert!(unknown.suggested_source.is_none());
    println!("PASS similar override cannot shadow exact model; unknown variant stays unverified");

    let custom: CatalogEntry = serde_json::from_value(serde_json::json!({
        "match":["kimi-k2.7-code"],"name":"本机核实版本","verified":true,"edited":true,
        "source":"https://platform.kimi.com/docs/pricing/chat",
        "price":{"currency":"CNY","input":7,"output":29,"cachedInput":0,"cacheWrite":0}
    })).unwrap();
    let cards = cards_for_account("moonshot", "synthetic", &[remote("kimi-k2.7-code")], &catalog, &[custom]);
    assert_eq!(cards[0].price.as_ref().unwrap().input, Some(7.0));
    assert_eq!(cards[0].price.as_ref().unwrap().cached_input, Some(0.0));
    assert!(cards[0].edited);
    println!("PASS explicit local override and zero cache prices preserved");

    let mut snapshot = load_ladder(&std::env::temp_dir().join("quota-catalog-checks-unused"));
    let mut local = catalog.iter().find(|e| e.r#match.contains(&"kimi-k2.6".into())).unwrap().clone();
    local.price.as_mut().unwrap().cached_input = Some(0.0);
    local.verified_at = Some("2026-10-04T04:00:00+08:00".into());
    for entry in &mut snapshot.entries {
        if entry.id.starts_with("kimi-k2-6") {
            entry.price_source = "https://platform.kimi.com/docs/pricing".into();
        }
    }
    let current = ladder_with_overrides(snapshot, &[local]);
    for id in ["kimi-k2-6", "kimi-k2-6-non-reasoning"] {
        let entry = current.entries.iter().find(|e| e.id == id).unwrap();
        assert_eq!(entry.price.cached_input, Some(0.0));
        assert_eq!(entry.price_source, "https://platform.kimi.com/docs/pricing/chat");
        assert_eq!(entry.verified_at.as_deref(), Some("2026-10-04T04:00:00+08:00"));
    }
    println!("PASS ladder evaluation variants share explicit API override; stale source refreshed");

    let builtin = catalog.iter().find(|e| e.r#match.contains(&"kimi-k3".into())).unwrap().clone();
    let mut old = builtin.clone();
    old.price.as_mut().unwrap().cached_input = None;
    old.verified_at = Some("2026-03-01T00:00:00+08:00".into());
    let (current, reference) = comparison_entries(&catalog, &[old.clone()], "moonshot", "kimi-k3");
    assert!(current.price.as_ref().unwrap().cached_input.is_none());
    assert_eq!(current.verified_at, old.verified_at);
    let cmp = compare(&current, reference.as_ref());
    assert_eq!(cmp["sources"][0]["cachedInput"], serde_json::Value::Null);
    assert_eq!(cmp["sources"][1]["cachedInput"], 2.0);
    assert_eq!(cmp["suggestedSource"]["kind"], "builtin");
    assert_eq!(cmp["confidence"], "medium");
    println!("PASS legacy missing cache remains untouched; builtin offered separately, same origin not counted twice");

    let mut parsed_price = builtin.price.clone().unwrap();
    parsed_price.cached_input = None;
    parsed_price.cache_write = None;
    parsed_price.cache_write_long = None;
    let scan = PageScan {
        url: builtin.source.clone().unwrap(), fetched_at: "2026-10-04T05:00:00+08:00".into(),
        excerpts: vec![], candidates: vec![parsed_price], error: None,
    };
    let scanned = build_comparison("kimi-k3", &old.name, "moonshot", old.price.clone(), old.verified,
        old.verified_at.clone(), old.source.clone(), Some(&builtin), Some(scan), None);
    assert_eq!(scanned.suggested_source.as_ref().unwrap().kind, "builtin");
    assert_eq!(scanned.suggested.as_ref().unwrap().cached_input, Some(2.0));
    assert!(scanned.sources.iter().any(|s| s.kind == "official_page" && !s.trusted));
    let mut newer = builtin.clone();
    newer.verified_at = Some("2026-10-04T05:01:00+08:00".into());
    newer.price.as_mut().unwrap().input = Some(21.0);
    assert_eq!(compare(&newer, Some(&builtin))["suggestedSource"]["kind"], "catalog");
    assert_eq!(compare(&newer, Some(&builtin))["suggested"]["input"], 21.0);
    newer.verified_at = builtin.verified_at.clone();
    newer.price.as_mut().unwrap().cached_input = None;
    assert_eq!(compare(&newer, Some(&builtin))["suggestedSource"]["kind"], "builtin");
    let mut empty_price = builtin.clone();
    let price = empty_price.price.as_mut().unwrap();
    price.input = None; price.output = None; price.cached_input = None;
    price.cache_write = None; price.cache_write_long = None;
    assert!(compare(&empty_price, None)["suggestedSource"].is_null());
    assert_eq!(compare(&empty_price, None)["confidence"], "none");
    let scan = PageScan {
        url: builtin.source.clone().unwrap(), fetched_at: "2026-10-04T05:00:00+08:00".into(),
        excerpts: vec![], candidates: vec![builtin.price.clone().unwrap()], error: None,
    };
    let scanned = build_comparison("kimi-k3", "Kimi K3", "moonshot", None, false, None, None, None, Some(scan), None);
    assert_eq!(scanned.suggested_source.as_ref().unwrap().kind, "official_page");
    assert!(!scanned.suggested_source.as_ref().unwrap().trusted);
    println!("PASS newest verified record preferred; scraped candidate stays separate, empty prices never recommended");

    old.source = None;
    old.verified_at = None;
    let (current, reference) = comparison_entries(&catalog, &[old.clone()], "moonshot", "kimi-k3");
    assert!(current.source.is_none() && current.verified_at.is_none());
    assert!(!compare(&current, reference.as_ref())["sources"][0]["trusted"].as_bool().unwrap());
    assert!(!cards_for_account("moonshot", "synthetic", &[remote("kimi-k3")], &catalog, &[old.clone()])[0].verified);
    old.price = None;
    let (current, reference) = comparison_entries(&catalog, &[old], "moonshot", "kimi-k3");
    assert!(current.price.is_none());
    assert_eq!(compare(&current, reference.as_ref())["sources"][0]["kind"], "builtin");
    println!("PASS missing provenance not borrowed or marked verified; metadata-only override retains separate builtin price");

    let mut alternate = builtin.clone();
    alternate.source = Some("https://independent.example/pricing".into());
    assert_eq!(compare(&builtin, Some(&alternate))["confidence"], "high");
    alternate.price.as_mut().unwrap().output = Some(999.0);
    assert_eq!(compare(&builtin, Some(&alternate))["confidence"], "medium");
    alternate.price = builtin.price.clone();
    alternate.price.as_mut().unwrap().cached_input = Some(0.0);
    assert_eq!(compare(&builtin, Some(&alternate))["confidence"], "medium");
    alternate.price = builtin.price.clone();
    alternate.price.as_mut().unwrap().currency = "USD".into();
    assert_eq!(compare(&builtin, Some(&alternate))["confidence"], "medium");
    alternate.price = builtin.price.clone();
    alternate.price.as_mut().unwrap().unit = "每 1K tokens".into();
    assert_eq!(compare(&builtin, Some(&alternate))["confidence"], "medium");
    alternate.price = builtin.price.clone();
    alternate.price.as_mut().unwrap().unit = "每百万 tokens".into();
    assert_eq!(compare(&builtin, Some(&alternate))["confidence"], "high");
    println!("PASS confidence checks output, cache, currency and units; equivalent million-token units accepted");

    let mut aliased = builtin.clone();
    aliased.r#match = vec!["old-k3-alias".into(), "kimi-k3".into(), "other-alias".into()];
    let unrelated: CatalogEntry = serde_json::from_value(serde_json::json!({"name":"legacy-unrelated","summary":"preserve"})).unwrap();
    let mut overrides = vec![aliased, unrelated];
    let before = serde_json::to_value(&overrides).unwrap();
    assert!(save_catalog_override(&mut overrides, builtin.clone(), |_| Err("synthetic write failure".into())).is_err());
    assert_eq!(serde_json::to_value(&overrides).unwrap(), before);
    save_catalog_override(&mut overrides, builtin.clone(), |_| Ok(())).unwrap();
    assert!(overrides.iter().any(|e| e.r#match.contains(&"other-alias".into())));
    assert!(overrides.iter().any(|e| e.name == "legacy-unrelated"));
    assert_eq!(overrides.iter().filter(|e| e.r#match.contains(&"kimi-k3".into())).count(), 1);
    assert_eq!(cards_for_account("moonshot", "synthetic", &[remote("kimi-k3")], &catalog, &overrides)[0].price.as_ref().unwrap().cached_input, Some(2.0));
    println!("PASS failed write preserves memory; secondary alias updated without deleting unrelated aliases or legacy records");

    let mut invalid = builtin.clone();
    invalid.price.as_mut().unwrap().input = Some(-1.0);
    assert!(validate_catalog_entry(&invalid).is_err());
    invalid.price.as_mut().unwrap().input = Some(f64::NAN);
    assert!(validate_catalog_entry(&invalid).is_err());
    invalid.price.as_mut().unwrap().input = Some(0.0);
    assert!(validate_catalog_entry(&invalid).is_ok());
    invalid.source = None;
    assert!(validate_catalog_entry(&invalid).is_err());
    invalid.verified = false;
    assert!(validate_catalog_entry(&invalid).is_ok());
    invalid.context = Some(0);
    assert!(validate_catalog_entry(&invalid).is_err());
    println!("PASS negative/nonfinite prices, missing provenance and invalid context rejected; zero and unknown allowed");
}
