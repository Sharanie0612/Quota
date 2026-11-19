//! Keep historical regression fixtures independent of clients installed on the
//! developer's computer. Each fixture explicitly enables only its own sources.
pub fn isolate(dir: &std::path::Path) {
    use quota_lib::activity::{self, sources};
    let options = activity::options_checked(dir).expect("fixture options");
    let mut workspace = sources::load(dir, &options).expect("fixture workspace");
    for source in &mut workspace.instances {
        if !source.legacy {
            source.enabled = false;
        }
    }
    sources::save(dir, &workspace).expect("isolate optional local clients");
}
