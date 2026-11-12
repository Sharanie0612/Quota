//! Bind the score snapshot to the index revision and the source's default cohort.
use super::{
    adapters::{aa_frames, aa_index_version},
    Dataset, Profile,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

pub const INDEX: &str = "https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index";
pub const PUBLICATION: &str = "https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v5/";
const HISTORY: &str = "https://artificialanalysis.ai/methodology/intelligence-benchmarking#version-history";
pub(super) const V5: &str = "Intelligence Index v5";
pub(super) const V5_PATCH: &str = "Intelligence Index v5.0.1";

pub(super) fn supported(version: &str) -> bool {
    matches!(version, V5 | V5_PATCH)
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Edition {
    pub version: String,
    pub published_at: String,
    pub url: String,
    pub primary_profiles: Vec<String>,
}
impl Edition {
    pub fn valid(&self, data: &Dataset) -> bool {
        let publication = match self.version.as_str() {
            V5 => self.url == PUBLICATION
                && chrono::NaiveDate::parse_from_str(&self.published_at, "%Y-%m-%d").is_ok(),
            // The version history gives a month for the regrade. A retrieval
            // date or the original v5 release cannot stand in for its date.
            V5_PATCH => self.url == HISTORY && self.published_at.is_empty(),
            _ => false,
        };
        publication
            && (5..=1000).contains(&self.primary_profiles.len())
            && self.primary_profiles.iter().collect::<BTreeSet<_>>().len() == self.primary_profiles.len()
            && self.primary_profiles.iter().all(|id| data.profiles.iter().any(|profile| {
                profile.id == *id && profile.source_id == "artificial-analysis" && profile.version == self.version
            }))
            && data.profiles.iter().filter(|profile| profile.source_id == "artificial-analysis")
                .all(|profile| profile.version == self.version)
    }
}

fn publication_date(value: &Value) -> Option<String> {
    if let Some(items) = value.as_array() {
        return items.iter().find_map(publication_date);
    }
    if matches!(value["@type"].as_str(), Some("Article" | "BlogPosting" | "NewsArticle"))
        && value["headline"] == "Announcing Artificial Analysis Intelligence Index v5"
    {
        return value["datePublished"].as_str()
            .filter(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok())
            .map(str::to_string);
    }
    value.get("@graph").and_then(publication_date)
}

fn primary(value: &Value, profiles: &[Profile], ids: &mut BTreeSet<String>) -> Result<(), String> {
    match value {
        Value::Object(object) => {
            if value["chartDefaultSelected"].is_boolean()
                && value["deprecated"] != true
                && value["intelligenceIndexIsEstimated"] != true
            {
                if let Some(profile) = value["slug"].as_str().and_then(|slug| profiles.iter().find(|profile| profile.id == slug)) {
                    if value["name"] != profile.name
                        || value["intelligenceIndex"].as_f64().is_none_or(|score| (score - profile.index).abs() > 0.000001)
                    {
                        return Err("评测页与排行榜的配置或分数不一致，保留上次资料".into());
                    }
                    if value["chartDefaultSelected"] == true {
                        ids.insert(profile.id.clone());
                    }
                }
            }
            for child in object.values() {
                primary(child, profiles, ids)?;
            }
        }
        Value::Array(items) => {
            for child in items {
                primary(child, profiles, ids)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn attach(data: &mut Dataset, index_html: &str, publication_html: &str) -> Result<(), String> {
    let frames = aa_frames(index_html)?;
    let version = aa_index_version(&frames)?;
    if data.profiles.iter().any(|profile| profile.version != version) {
        return Err("AA 两个来源的指数版本不一致，保留上次资料".into());
    }
    let (published_at, url) = if version == V5 {
        let document = scraper::Html::parse_document(publication_html);
        let selector = scraper::Selector::parse("script[type='application/ld+json']").expect("static selector");
        let date = document.select(&selector)
            .filter_map(|node| serde_json::from_str::<Value>(&node.inner_html()).ok())
            .find_map(|value| publication_date(&value))
            .ok_or("测评版本发布日期未确认，保留上次资料")?;
        (date, PUBLICATION)
    } else {
        (String::new(), HISTORY)
    };
    let mut ids = BTreeSet::new();
    for frame in &frames {
        primary(frame, &data.profiles, &mut ids)?;
    }
    if ids.len() < 5 {
        return Err("主力测评范围结构变化，保留上次资料".into());
    }
    let vendors: BTreeSet<_> = data.profiles.iter().map(|profile| &profile.vendor).collect();
    for vendor in vendors {
        if !data.profiles.iter().any(|profile| &profile.vendor == vendor && ids.contains(&profile.id)) {
            if let Some(profile) = data.profiles.iter().filter(|profile| &profile.vendor == vendor)
                .max_by(|a, b| a.index.total_cmp(&b.index).then_with(|| b.id.cmp(&a.id)))
            {
                ids.insert(profile.id.clone());
            }
        }
    }
    let edition = Edition {
        version: version.into(),
        published_at,
        url: url.into(),
        primary_profiles: ids.into_iter().collect(),
    };
    if !edition.valid(data) {
        return Err("主力测评范围结构变化，保留上次资料".into());
    }
    data.sources.iter_mut().find(|source| source.id == "artificial-analysis")
        .ok_or("缺少评测来源")?.edition = Some(edition);
    Ok(())
}
