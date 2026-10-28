//! Public evaluation edition date and the source's current comparison cohort.
//! Retrieval time and model release time never stand in for evaluation freshness.
use super::{Dataset,Profile};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
pub const INDEX:&str="https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index";
pub const PUBLICATION:&str="https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v5/";
const VERSION:&str="Intelligence Index v5";
#[derive(Clone,Serialize,Deserialize,Debug)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Edition {pub version:String,pub published_at:String,pub url:String,pub primary_profiles:Vec<String>}
impl Edition {
    pub fn valid(&self,data:&Dataset)->bool{
        self.version==VERSION&&self.url==PUBLICATION&&chrono::NaiveDate::parse_from_str(&self.published_at,"%Y-%m-%d").is_ok()
            && self.primary_profiles.len()>=5&&self.primary_profiles.len()<=1000
            && self.primary_profiles.iter().collect::<BTreeSet<_>>().len()==self.primary_profiles.len()
            && self.primary_profiles.iter().all(|id|data.profiles.iter().any(|p|p.id==*id&&p.source_id=="artificial-analysis"&&p.version==self.version))
    }
}
fn publication_date(value:&Value)->Option<String>{
    if let Some(items)=value.as_array(){return items.iter().find_map(publication_date)}
    if matches!(value["@type"].as_str(),Some("Article"|"BlogPosting"|"NewsArticle"))&&value["headline"]=="Announcing Artificial Analysis Intelligence Index v5"{
        return value["datePublished"].as_str().filter(|date|chrono::NaiveDate::parse_from_str(date,"%Y-%m-%d").is_ok()).map(str::to_string)
    }
    value.get("@graph").and_then(publication_date)
}
fn primary(value:&Value,profiles:&[Profile],ids:&mut BTreeSet<String>)->Result<(),String>{
    match value{
        Value::Object(object)=>{
            if value["chartDefaultSelected"]==true&&value["deprecated"]!=true&&value["intelligenceIndexIsEstimated"]!=true{
                if let Some(profile)=value["slug"].as_str().and_then(|slug|profiles.iter().find(|p|p.id==slug)){
                    if value["intelligenceIndex"].as_f64().is_none_or(|score|(score-profile.index).abs()>0.000001){return Err("主力型号与测评原分不一致，保留上次资料".into())}
                    ids.insert(profile.id.clone());
                }
            }
            for child in object.values(){primary(child,profiles,ids)?}
        },
        Value::Array(items)=>for child in items{primary(child,profiles,ids)?},
        _=>{}
    }Ok(())
}
pub fn attach(data:&mut Dataset,index_html:&str,publication_html:&str)->Result<(),String>{
    let document=scraper::Html::parse_document(publication_html);
    let selector=scraper::Selector::parse("script[type='application/ld+json']").expect("static selector");
    let date=document.select(&selector).filter_map(|node|serde_json::from_str::<Value>(&node.inner_html()).ok()).find_map(|value|publication_date(&value)).ok_or("测评版本发布日期未确认，保留上次资料")?;
    let mut stream=String::new();
    for chunk in index_html.split("self.__next_f.push(").skip(1){if let Some((json,_))=chunk.split_once(")</script>"){if let Ok(value)=serde_json::from_str::<Value>(json){if let Some(text)=value.get(1).and_then(Value::as_str){stream.push_str(text)}}}}
    let mut ids=BTreeSet::new();for line in stream.lines(){if let Some((_,body))=line.split_once(':'){if let Ok(value)=serde_json::from_str::<Value>(body){primary(&value,&data.profiles,&mut ids)?}}}
    if ids.len()<5{return Err("当前主力测评范围结构变化，保留上次资料".into())}
    // Keep every measured vendor represented even when the source's default chart
    // omits it: use that vendor's highest complete current configuration.
    let vendors:BTreeSet<_>=data.profiles.iter().map(|p|&p.vendor).collect();
    for vendor in vendors{if !data.profiles.iter().any(|p|&p.vendor==vendor&&ids.contains(&p.id)){if let Some(profile)=data.profiles.iter().filter(|p|&p.vendor==vendor).max_by(|a,b|a.index.total_cmp(&b.index).then_with(||b.id.cmp(&a.id))){ids.insert(profile.id.clone());}}}
    let edition=Edition{version:VERSION.into(),published_at:date,url:PUBLICATION.into(),primary_profiles:ids.into_iter().collect()};
    if !edition.valid(data){return Err("当前主力测评范围结构变化，保留上次资料".into())}
    data.sources.iter_mut().find(|s|s.id=="artificial-analysis").ok_or("缺少评测来源")?.edition=Some(edition);Ok(())
}
