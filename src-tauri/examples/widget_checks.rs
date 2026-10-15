use chrono::TimeZone;
use quota_lib::{activity,widget};
fn main(){
    assert_eq!(widget::bounds(0,0,1920,1040,1.0,false,false,50),(1898,470,22,100));
    assert_eq!(widget::bounds(-1920,-100,1920,1040,1.5,true,true,0),(-1920,-100,438,279));
    assert_eq!(widget::bounds(-1920,0,1920,1040,1.0,true,false,100),(-292,854,292,186));
    assert_eq!(widget::bounds(0,0,100,80,2.0,true,false,50),(0,0,100,80));
    println!("PASS edge placement: negative monitor origins, DPI, top/bottom bounds, small work areas");
    let root=std::env::temp_dir().join(format!("quota-widget-check-{}",uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    activity::report(&root,None,None,None).unwrap();
    let db=rusqlite::Connection::open(root.join("activity.sqlite")).unwrap();
    let today=chrono::Local::now().date_naive();
    for(i,source,day,total)in [(1,"codex",today,100),(2,"zcode",today,50),(3,"trae",today,900),(4,"harness",today.pred_opt().unwrap(),20),(5,"codex",today.succ_opt().unwrap(),800)]{
        let metric=activity::Metric{id:format!("{i:064x}"),device:"00000000-0000-4000-8000-000000000001".into(),source:source.into(),session:format!("s{i}"),model:"gpt-test".into(),agent:String::new(),tool:String::new(),timestamp:chrono::Local.from_local_datetime(&day.and_hms_opt(0,0,0).unwrap()).earliest().unwrap().timestamp_millis(),kind:"tokens".into(),tokens:activity::Tokens{input:total-10,output:10,cached:10,reasoning:2,total,..Default::default()},channel:String::new(),harness_identity:0,revision:0};
        assert!(activity::merge_metric(&db,&metric,false).unwrap());assert!(!activity::merge_metric(&db,&metric,false).unwrap());
    }
    let summary=activity::usage_summary(&root).unwrap();
    assert_eq!((summary.today,summary.total),(150,170));
    assert_eq!(summary.date,today.to_string());
    let all=activity::report_filtered(&root,None,Some("without-trae".into()),Some(0),None).unwrap();
    let day=activity::report_range(&root,None,Some("without-trae".into()),Some(0),None,Some(today.to_string()),Some(today.to_string())).unwrap();
    assert_eq!(summary.total,all.totals.tokens.total);assert_eq!(summary.today,day.totals.tokens.total);
    std::fs::write(root.join("activity-status.json"),r#"{"at":123,"errors":["synthetic incomplete source"]}"#).unwrap();
    let summary=activity::usage_summary(&root).unwrap();assert!(summary.partial);assert_eq!(summary.updated_at,Some(123));
    println!("PASS widget uses existing deduplicated metrics, same local calendar/scope as My Usage, excludes Trae/future days and never adds cache/reasoning twice; partial reads labelled");
    drop(db);std::fs::remove_dir_all(root).unwrap();
}
