use quota_lib::parse_exchange_reference;
fn main() {
    let (rate, date) = parse_exchange_reference("<Cube time='2026-10-02'><Cube currency='USD' rate='2'/><Cube currency='CNY' rate='14'/></Cube>").unwrap();
    assert_eq!(rate, 7.0); assert_eq!(date, "2026-10-02");
    assert_eq!(parse_exchange_reference("<Cube time=\"2026-10-02\"><Cube rate=\"14\" currency=\"CNY\"/><Cube rate=\"2\" currency=\"USD\"/></Cube>").unwrap().0, 7.0);
    for bad in ["<Cube time='bad'><Cube currency='USD' rate='1'/><Cube currency='CNY' rate='7'/>", "<Cube time='2026-10-02'><Cube currency='USD' rate='0'/><Cube currency='CNY' rate='7'/>", "<Cube time='2026-10-02'><Cube currency='USD' rate='NaN'/><Cube currency='CNY' rate='7'/>", "<Cube time='2026-10-02'><Cube currency='USD' rate='1'/>"] { assert!(parse_exchange_reference(bad).is_err()); }
    println!("PASS official FX cross-rate, reversed attributes, quotes and invalid/missing fields");
    if let Some(path) = std::env::args().nth(1) {
        let xml = std::fs::read_to_string(path).unwrap(); let (rate, date) = parse_exchange_reference(&xml).unwrap();
        println!("PASS fetched ECB reference date={date} CNY/USD={rate:.6}");
    }
    let money = quota_lib::parse_balance(r#"{"code":0,"data":{"balance":"5","cashBalance":"3","totalRechargeAmount":"40"}}"#).unwrap();
    assert_eq!(money.cumulative_recharge, Some(40.0));
    let money = quota_lib::parse_balance(r#"{"code":0,"data":{"balance":"5","cashBalance":"3","rechargeAmount":"40"}}"#).unwrap();
    assert_eq!(money.cumulative_recharge, None);
    println!("PASS MiMo explicit cumulative field retained; payment amount and current balance not mislabelled");
}
