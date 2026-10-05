pub fn display_version() -> String {
    let parts: Vec<&str> = env!("CARGO_PKG_VERSION").split('.').collect();
    let patch = parts[2].parse::<u32>().expect("valid package patch");
    format!("{}.{}.{:04}", parts[0], parts[1], patch)
}
