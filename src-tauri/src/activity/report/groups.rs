use super::{model_vendor, sources, Group, Metric, Tokens, UsageDetail};
use std::collections::{BTreeMap, HashSet};

#[derive(Default)]
pub(super) struct Counts {
    tokens: Tokens,
    calls: u64,
    sessions: HashSet<usize>,
}

impl Counts {
    pub fn add(&mut self, event: &Metric, session: usize) {
        self.tokens.add(&event.tokens);
        self.calls += u64::from(event.kind == "tool");
        self.sessions.insert(session);
    }

    pub fn finish(self, key: String) -> Group {
        Group {
            key,
            tokens: self.tokens,
            calls: self.calls,
            sessions: self.sessions.len() as u64,
        }
    }
}

#[derive(Default)]
pub(super) struct Groups(BTreeMap<String, Counts>);

impl Groups {
    pub fn add(&mut self, key: &str, event: &Metric, session: usize) {
        let counts = match self.0.get_mut(key) {
            Some(existing) => existing,
            None => self.0.entry(key.to_owned()).or_default(),
        };
        counts.add(event, session);
    }

    pub fn finish(self) -> Vec<Group> {
        self.0
            .into_iter()
            .map(|(key, counts)| counts.finish(key))
            .collect()
    }
}

#[derive(Default)]
pub(super) struct SourceGroups {
    pub software: Groups,
    pub launcher: Groups,
    pub environment: Groups,
    pub access: Groups,
}

impl SourceGroups {
    pub fn add(&mut self, event: &Metric, session: usize) {
        self.software.add(sources::software(event), event, session);
        self.launcher.add(sources::launcher(event), event, session);
        self.environment
            .add(sources::environment(event), event, session);
        self.access.add(sources::access(event), event, session);
    }
}

// Field order is also the established tie-breaker for equal Token totals.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct DetailKey {
    software: String,
    launcher: String,
    environment: String,
    access: String,
    model: String,
}

#[derive(Default)]
pub(super) struct Details(BTreeMap<DetailKey, Counts>);

impl Details {
    pub fn add(&mut self, event: &Metric, session: usize) {
        let key = DetailKey {
            software: sources::software(event).into(),
            launcher: sources::launcher(event).into(),
            environment: sources::environment(event).into(),
            access: sources::access(event).into(),
            model: event.model.clone(),
        };
        self.0.entry(key).or_default().add(event, session);
    }

    pub fn finish(self) -> Vec<UsageDetail> {
        let mut rows: Vec<_> = self
            .0
            .into_iter()
            .map(|(key, counts)| UsageDetail {
                vendor: model_vendor(&key.model).into(),
                software: key.software,
                launcher: key.launcher,
                environment: key.environment,
                access: key.access,
                model: key.model,
                tokens: counts.tokens,
                calls: counts.calls,
                sessions: counts.sessions.len() as u64,
            })
            .collect();
        rows.sort_by_key(|row| std::cmp::Reverse(row.tokens.total));
        rows
    }
}
