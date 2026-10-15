use quota_lib::usage_fx::{self, parse_history, reference};
use std::fs;
fn main() {
    if let Some(path) = std::env::args().nth(1) {
        let xml = fs::read_to_string(path).unwrap();
        let history = parse_history(&xml).unwrap();
        let current = chrono::Local::now().format("%Y-%m").to_string();
        let r = reference(&history, &current).unwrap().unwrap();
        assert!(r.date < format!("{current}-01"));
        println!(
            "PASS official ECB history {} observations; {} fixed reference {} from {}",
            history.len(),
            r.month,
            r.cny_per_usd,
            r.date
        );
        return;
    }
    let xml="<Cube time='2026-10-02'><Cube currency='USD' rate='1.5'/><Cube currency='CNY' rate='12'/></Cube><Cube time='2026-09-30'><Cube currency='USD' rate='1.2'/><Cube currency='CNY' rate='8.4'/></Cube><Cube time='2026-09-29'><Cube currency='USD' rate='1'/><Cube currency='CNY' rate='6'/></Cube>";
    let h = parse_history(xml).unwrap();
    let r = reference(&h, "2026-10").unwrap().unwrap();
    assert_eq!(r.date, "2026-09-30");
    assert!((r.cny_per_usd-7.0).abs()<1e-12);
    assert!(reference(&h, "2026-09").unwrap().is_none());
    assert!(reference(&h, "2026-13").is_err());
    assert!(parse_history("<Cube time='2026-09-30'><Cube currency='USD' rate='1'/></Cube><Cube time='2026-10-01'><Cube currency='CNY' rate='7'/></Cube>").is_err());
    assert!(parse_history(&" ".repeat(16 * 1024 * 1024 + 1)).is_err());
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/usage-fx-checks")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&root).unwrap();
    usage_fx::save_manual(&root, "2026-10", Some(7.1234)).unwrap();
    let bytes = fs::read(root.join("monthly-usage-fx.json")).unwrap();
    assert!(usage_fx::save_manual(&root, "2026-10", Some(f64::NAN)).is_err());
    assert_eq!(bytes, fs::read(root.join("monthly-usage-fx.json")).unwrap());
    usage_fx::save_manual(&root, "2026-10", None).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("monthly-usage-fx.json")).unwrap(),
        "{}"
    );
    let resolved = root.canonicalize().unwrap();
    assert!(resolved.starts_with(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .canonicalize()
            .unwrap()
    ));
    fs::remove_dir_all(resolved).unwrap();
    println!("PASS previous-month final quote, no intra-month quote, no currency mixing across dates, bounded XML, missing quote, invalid month, manual reference persistence and atomic restore");
}
