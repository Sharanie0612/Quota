use quota_lib::activity::ssh::discovery::{discover, discover_from};
use std::{fs, path::Path};

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/ssh-discovery-checks").join(uuid::Uuid::new_v4().to_string());
    let home = root.join("home"); let user = home.join(".ssh/config"); let system = root.join("system/ssh_config");
    fs::create_dir_all(user.parent().unwrap().join("configs")).unwrap();
    fs::create_dir_all(system.parent().unwrap()).unwrap();
    let missing = discover_from(&home, &user, &system); assert!(missing.hosts.is_empty() && missing.warnings.is_empty());
    let marker = root.join("SHOULD_NOT_EXIST");
    fs::write(&user, format!("\u{feff}hOsT = \"ubuntu-vm\" devbox blocked !blocked # comment\nHost devbox DEVBOX *.wild !negated user@host -oOption\nInclude \"configs/*.conf\" \"spaced config\"\nMatch exec \"echo PRIVATE_COMMAND > {}\"\nIdentityFile PRIVATE_KEY_SHOULD_NOT_BE_READ\nProxyCommand PRIVATE_PROXY_COMMAND\nHost after-match\nInclude dynamic-%h.conf recursive/**/*.conf\nHost \"unterminated\n", marker.display())).unwrap();
    fs::write(home.join(".ssh/configs/a.conf"), "Host included\nInclude configs/nested.conf\n").unwrap();
    fs::write(home.join(".ssh/configs/nested.conf"), "Host nested\nInclude config\n").unwrap();
    fs::write(home.join(".ssh/spaced config"), "Host \"quoted-alias\" # comment\n").unwrap();
    fs::write(&system, "Host gateway ubuntu-vm\n").unwrap();
    let report = discover_from(&home, &user, &system);
    assert_eq!(report.hosts, vec!["after-match", "devbox", "gateway", "included", "nested", "quoted-alias", "ubuntu-vm"]);
    assert!(!report.warnings.is_empty()); assert!(!marker.exists());
    let json = serde_json::to_string(&report).unwrap(); assert!(!json.contains("PRIVATE")); assert!(!json.contains(&root.to_string_lossy().to_string()));
    // A broken user config must not hide valid system aliases.
    fs::write(&user, vec![b'x'; 256 * 1024 + 1]).unwrap();
    let report = discover_from(&home, &user, &system); assert_eq!(report.hosts, vec!["gateway", "ubuntu-vm"]); assert!(!report.warnings.is_empty());
    fs::write(&user, [0xff, 0xfe, 0x81]).unwrap(); assert!(!discover_from(&home, &user, &system).warnings.is_empty());
    // Deep Include chains and large host inventories stop without losing results.
    fs::write(&user, "Host first\nInclude depth0\n").unwrap();
    for i in 0..12 { fs::write(home.join(format!(".ssh/depth{i}")), format!("Host depth-{i}\nInclude depth{}\n", i + 1)).unwrap(); }
    let report = discover_from(&home, &user, &system); assert!(report.hosts.iter().any(|h| h == "first")); assert!(report.warnings.iter().any(|w| w.contains("上限")));
    fs::write(&user, (0..140).map(|i| format!("Host host-{i:03}\n")).collect::<String>()).unwrap();
    let report = discover_from(&home, &user, &system); assert_eq!(report.hosts.len(), 128); assert!(!report.warnings.is_empty());
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        let locked = fs::OpenOptions::new().read(true).share_mode(0).open(&user).unwrap();
        let report = discover_from(&home, &user, &system); assert_eq!(report.hosts, vec!["gateway", "ubuntu-vm"]); assert!(!report.warnings.is_empty()); drop(locked);
    }
    println!("PASS SSH discovery: quoted/equal directives, literal aliases, exclusions, case dedup, root-relative Include globs, cycles/depth/size/host bounds, locked files, privacy and no command execution");
    if std::env::args().any(|arg| arg == "--live") { let report = discover(); println!("Local configuration inspection only: hosts={}, warnings={}", report.hosts.len(), report.warnings.len()); }
}
