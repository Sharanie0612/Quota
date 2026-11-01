use super::{identity, Dataset, Source};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
pub const URL: &str = "https://artificialanalysis.ai/models/releases";
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Release {
    pub id:String, pub name:String, pub vendor:String, pub released_at:String, pub url:String,
}
impl Release {
    pub fn valid(&self) -> bool {
        !self.id.is_empty() && self.id.len() <= 160 && self.name.len() <= 200 && self.vendor.len() <= 100
            && chrono::NaiveDate::parse_from_str(&self.released_at,"%Y-%m-%d").is_ok()
            && self.url.starts_with("https://artificialanalysis.ai/models/")
    }
}
fn walk(value:&Value,out:&mut BTreeMap<String,Release>) {
    match value {
        Value::Object(object) => {
            if object.get("isDeprecated") != Some(&Value::Bool(true)) {
                if let (Some(name),Some(date),Some(vendor),Some(href)) = (value["name"].as_str(),value["releaseDate"].as_str(),value["creator"]["name"].as_str(),value["href"].as_str()) {
                    if href.starts_with("/models/") && !href.contains("..") {
                        let item=Release{id:identity(name),name:name.into(),vendor:vendor.into(),released_at:date.into(),url:format!("https://artificialanalysis.ai{href}")};
                        if item.valid() {out.entry(item.id.clone()).or_insert(item);}
                    }
                }
            }
            for child in object.values() {walk(child,out);}
        }
        Value::Array(values) => for value in values {walk(value,out)},
        _ => {}
    }
}
pub fn parse(html:&str,checked:&str)->Result<Dataset,String> {
    let mut stream=String::new();
    for chunk in html.split("self.__next_f.push(").skip(1) {
        let Some((json,_))=chunk.split_once(")</script>") else {continue};
        if let Ok(value)=serde_json::from_str::<Value>(json) {if let Some(text)=value.get(1).and_then(Value::as_str) {stream.push_str(text);}}
    }
    let mut rows=BTreeMap::new();
    for line in stream.lines() {if let Some((_,json))=line.split_once(':') {if let Ok(value)=serde_json::from_str::<Value>(json) {walk(&value,&mut rows);}}}
    if rows.len()<50 {return Err("型号发布日期来源结构变化，保留上次记录".into())}
    let records=rows.len();
    Ok(Dataset{schema:3,releases:rows.into_values().collect(),sources:vec![Source{id:"model-releases".into(),name:"型号发布日期".into(),url:URL.into(),version:"Artificial Analysis release directory".into(),checked_at:checked.into(),records,automatic:true,..Default::default()}],..Default::default()})
}
