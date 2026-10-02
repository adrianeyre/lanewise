use std::process::Command;

#[test]
fn says_web_mode_is_not_built_yet_and_fails() {
    let output = Command::new(env!("CARGO_BIN_EXE_lanewise-serve"))
        .output()
        .expect("lanewise-serve runs");

    assert!(!output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "lanewise-serve: Web Mode is not built yet\n"
    );
}
