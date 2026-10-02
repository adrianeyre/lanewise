use std::env;
use std::path::Path;

fn main() {
    // tauri-build embeds the Common Controls v6 manifest in the app's binary
    // only, so on Windows the lib's unit-test binary loads comctl32 v5, which
    // has no `TaskDialogIndirect`, and dies with STATUS_ENTRYPOINT_NOT_FOUND
    // before a test runs (tauri-apps/tauri#13419). With MSVC, the linker
    // embeds the same manifest in everything this crate links instead, and
    // tauri-build's copy is turned off so the app doesn't carry two.
    // `/MANIFESTUAC:NO` keeps the app's manifest the one tauri-build gives.
    let mut windows = tauri_build::WindowsAttributes::new();
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        let manifest = Path::new(&env::var("CARGO_MANIFEST_DIR").expect("Cargo sets it"))
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFESTUAC:NO");
    }
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("tauri-build runs");
}
