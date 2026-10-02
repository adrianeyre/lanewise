//! Commands called by name with JSON, as a shell calls them, against
//! repositories built with the real `git` CLI.

#[path = "../../core/tests/support/stalled.rs"]
mod stalled;
#[path = "../../core/tests/support/mod.rs"]
mod support;

use std::fs;
use std::path::Path;

use lanewise_commands::{Reply, call};
use serde_json::{Value, json};
use tempfile::TempDir;

fn run_git(dir: &Path, args: &[&str]) {
    let output = support::git()
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// A new repository with `count` untracked files, `file-00.txt` onwards.
fn repository_with_untracked_files(count: usize) -> TempDir {
    let dir = tempfile::tempdir().expect("a temporary folder");
    run_git(dir.path(), &["init", "--quiet", "-b", "main"]);
    for n in 0..count {
        fs::write(dir.path().join(format!("file-{n:02}.txt")), "").expect("the file is written");
    }
    dir
}

fn value(reply: Reply) -> Value {
    match reply {
        Reply::Ok { value } => value,
        other => panic!("expected a response, got {other:?}"),
    }
}

fn error(reply: Reply) -> Value {
    match reply {
        Reply::Failed { error } => error,
        other => panic!("expected an error, got {other:?}"),
    }
}

#[test]
fn opens_a_repository_and_reads_its_status_page_by_page() {
    let dir = repository_with_untracked_files(5);

    let opened = value(call("openRepository", json!({ "path": dir.path() })));
    let root = opened["root"].clone();
    assert_eq!(
        opened["name"],
        json!(dir.path().file_name().unwrap().to_string_lossy())
    );
    // With no remote, it's on no Host.
    assert_eq!(opened["web"], Value::Null);

    let mut paths = Vec::new();
    let mut cursor = Value::Null;
    let mut pages = 0;
    loop {
        let page = value(call(
            "fileStatus",
            json!({ "repository": root, "page": { "cursor": cursor, "limit": 2 } }),
        ));
        pages += 1;
        for item in page["items"].as_array().expect("items") {
            assert_eq!(item["change"], json!({ "kind": "untracked" }));
            assert_eq!(item["staged"], json!(false));
            paths.push(item["path"].as_str().expect("a path").to_owned());
        }
        cursor = page["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }

    assert_eq!(pages, 3);
    assert_eq!(
        paths,
        [
            "file-00.txt",
            "file-01.txt",
            "file-02.txt",
            "file-03.txt",
            "file-04.txt"
        ]
    );
}

#[test]
fn a_folder_that_is_not_a_repository_fails_saying_so() {
    let dir = tempfile::tempdir().expect("a temporary folder");

    assert_eq!(
        error(call("openRepository", json!({ "path": dir.path() }))),
        json!({ "kind": "notARepository", "path": dir.path() })
    );
    assert_eq!(
        error(call("fileStatus", json!({ "repository": dir.path() }))),
        json!({ "kind": "notARepository", "path": dir.path() })
    );
}

#[test]
fn a_cursor_the_command_did_not_make_fails_as_invalid() {
    let dir = repository_with_untracked_files(1);

    assert_eq!(
        error(call(
            "fileStatus",
            json!({ "repository": dir.path(), "page": { "cursor": "made up" } })
        )),
        json!({ "kind": "invalidCursor" })
    );
}

#[test]
fn a_request_missing_its_fields_is_rejected() {
    let reply = serde_json::to_value(call("openRepository", json!({}))).unwrap();

    assert_eq!(reply["outcome"], "rejected");
    assert_eq!(reply["rejection"]["kind"], "invalidRequest");
    assert_eq!(reply["rejection"]["name"], "openRepository");
}

/// Both are refused before the OS credential store is reached, so this never
/// touches it.
#[test]
fn a_model_provider_key_is_refused_for_a_bad_id_or_when_empty() {
    let reply = serde_json::to_value(call(
        "saveModelProviderKey",
        json!({ "provider": "Not An ID", "key": "sk-a" }),
    ))
    .unwrap();
    assert_eq!(reply["outcome"], "rejected");
    assert_eq!(reply["rejection"]["kind"], "invalidRequest");

    assert_eq!(
        error(call(
            "saveModelProviderKey",
            json!({ "provider": "anthropic", "key": "  \n" })
        )),
        json!({ "kind": "emptyKey" })
    );
}

#[test]
fn checks_the_git_setup_and_finds_the_tests_git() {
    support::git();

    let setup = value(call("checkGitSetup", json!({})));

    assert_eq!(setup["git"]["kind"], "supported", "{setup}");
    assert_eq!(setup["minimumVersion"], "2.40.0");
    assert!(
        ["configured", "notConfigured"]
            .contains(&setup["credentialManager"]["kind"].as_str().expect("a kind")),
        "{setup}"
    );
    assert_eq!(
        setup["complete"],
        json!(setup["credentialManager"]["kind"] == "configured")
    );
}

/// Runs `git` in `dir` with a fixed identity, and gives its output.
fn git_output(dir: &Path, args: &[&str]) -> String {
    let output = support::git()
        .current_dir(dir)
        .args([
            "-c",
            "user.name=Lanewise Tests",
            "-c",
            "user.email=tests@lanewise.invalid",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .env("GIT_AUTHOR_DATE", "@1000 +0000")
        .env("GIT_COMMITTER_DATE", "@1000 +0000")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("UTF-8")
        .trim()
        .to_owned()
}

/// Commits everything in `dir` and gives the new commit's ID.
fn commit(dir: &Path, message: &str) -> String {
    git_output(dir, &["add", "--all"]);
    git_output(dir, &["commit", "--quiet", "--allow-empty", "-m", message]);
    git_output(dir, &["rev-parse", "HEAD"])
}

/// A new repository with commits `First` to `Fifth`, each adding a file, and
/// their IDs, oldest first.
fn repository_with_commits() -> (TempDir, Vec<String>) {
    let dir = repository_with_untracked_files(0);
    let ids = ["First", "Second", "Third", "Fourth", "Fifth"]
        .iter()
        .map(|message| {
            fs::write(dir.path().join(format!("{message}.txt")), message)
                .expect("the file is written");
            commit(dir.path(), message)
        })
        .collect();
    (dir, ids)
}

/// Every commit's `summary`, reading the history `limit` at a time.
fn read_history(dir: &Path, limit: u32) -> (Vec<Value>, usize) {
    let mut commits = Vec::new();
    let mut cursor = Value::Null;
    let mut pages = 0;
    loop {
        let page = value(call(
            "commitHistory",
            json!({ "repository": dir, "page": { "cursor": cursor, "limit": limit } }),
        ));
        pages += 1;
        commits.extend(page["items"].as_array().expect("items").iter().cloned());
        cursor = page["nextCursor"].clone();
        if cursor.is_null() {
            return (commits, pages);
        }
    }
}

#[test]
fn reads_the_history_newest_first_page_by_page() {
    let (dir, ids) = repository_with_commits();
    git_output(dir.path(), &["tag", "v1.0", &ids[1]]);

    let (commits, pages) = read_history(dir.path(), 2);

    assert_eq!(pages, 3);
    let summaries: Vec<&str> = commits
        .iter()
        .map(|commit| commit["summary"].as_str().expect("a summary"))
        .collect();
    assert_eq!(summaries, ["Fifth", "Fourth", "Third", "Second", "First"]);
    assert_eq!(commits[0]["id"], json!(ids[4]));
    assert_eq!(commits[0]["author"], "Lanewise Tests");
    assert_eq!(commits[0]["time"], 1000);
    assert!(ids[4].starts_with(commits[0]["shortId"].as_str().expect("a short ID")));
    assert_eq!(
        commits[0]["labels"],
        json!([{ "kind": "currentBranch", "name": "main" }])
    );
    assert_eq!(
        commits[3]["labels"],
        json!([{ "kind": "tag", "name": "v1.0" }])
    );
    assert_eq!(commits[2]["labels"], json!([]));
}

#[test]
fn a_new_commit_is_at_the_top_of_the_history_read_after_it() {
    let (dir, _) = repository_with_commits();
    assert_eq!(read_history(dir.path(), 200).0.len(), 5);

    let sixth = commit(dir.path(), "Sixth");

    let (commits, _) = read_history(dir.path(), 200);
    assert_eq!(commits.len(), 6);
    assert_eq!(commits[0]["id"], json!(sixth));
}

#[test]
fn a_history_cursor_whose_commit_has_gone_fails_as_invalid() {
    let (dir, ids) = repository_with_commits();
    let first = value(call(
        "commitHistory",
        json!({ "repository": dir.path(), "page": { "limit": 1 } }),
    ));

    git_output(dir.path(), &["reset", "--quiet", "--hard", &ids[0]]);

    assert_eq!(
        error(call(
            "commitHistory",
            json!({ "repository": dir.path(), "page": { "cursor": first["nextCursor"] } })
        )),
        json!({ "kind": "invalidCursor" })
    );
    assert_eq!(
        error(call(
            "commitHistory",
            json!({ "repository": dir.path(), "page": { "cursor": "made up" } })
        )),
        json!({ "kind": "invalidCursor" })
    );
}

#[test]
fn reads_a_commits_details_and_its_changed_files_page_by_page() {
    let (dir, ids) = repository_with_commits();
    for name in ["a.txt", "b.txt", "c.txt"] {
        fs::write(dir.path().join(name), name).expect("the file is written");
    }
    fs::remove_file(dir.path().join("First.txt")).expect("the file is removed");
    let sixth = commit(dir.path(), "Sixth\n\nWith a body.");

    let details = value(call(
        "commitDetails",
        json!({ "repository": dir.path(), "commit": sixth }),
    ));
    assert_eq!(details["id"], json!(sixth));
    assert_eq!(details["message"], "Sixth\n\nWith a body.");
    assert_eq!(
        details["author"],
        json!({ "name": "Lanewise Tests", "email": "tests@lanewise.invalid", "time": 1000 })
    );
    assert_eq!(details["committer"], details["author"]);
    assert_eq!(details["parents"][0]["id"], json!(ids[4]));
    assert_eq!(details["parents"].as_array().expect("parents").len(), 1);

    let first = value(call(
        "commitChanges",
        json!({ "repository": dir.path(), "commit": sixth, "page": { "limit": 3 } }),
    ));
    let rest = value(call(
        "commitChanges",
        json!({
            "repository": dir.path(),
            "commit": sixth,
            "page": { "cursor": first["nextCursor"], "limit": 3 }
        }),
    ));
    assert_eq!(
        first["items"],
        json!([
            { "path": "First.txt", "change": { "kind": "deleted" } },
            { "path": "a.txt", "change": { "kind": "added" } },
            { "path": "b.txt", "change": { "kind": "added" } }
        ])
    );
    assert_eq!(
        rest,
        json!({
            "items": [{ "path": "c.txt", "change": { "kind": "added" } }],
            "nextCursor": null
        })
    );
}

#[test]
fn a_commit_that_is_not_there_is_not_found() {
    let (dir, _) = repository_with_commits();

    for commit in ["0123456789abcdef0123456789abcdef01234567", "HEAD"] {
        assert_eq!(
            error(call(
                "commitDetails",
                json!({ "repository": dir.path(), "commit": commit })
            )),
            json!({ "kind": "commitNotFound", "commit": commit })
        );
        assert_eq!(
            error(call(
                "commitChanges",
                json!({ "repository": dir.path(), "commit": commit })
            )),
            json!({ "kind": "commitNotFound", "commit": commit })
        );
    }
}

#[test]
fn an_empty_repository_has_an_empty_history() {
    let dir = repository_with_untracked_files(0);

    assert_eq!(
        value(call("commitHistory", json!({ "repository": dir.path() }))),
        json!({ "items": [], "nextCursor": null })
    );
}

/// The `graphWindow` row whose commit's summary is `summary`.
fn row<'a>(window: &'a Value, summary: &str) -> &'a Value {
    window["rows"]
        .as_array()
        .expect("rows")
        .iter()
        .find(|row| row["summary"] == summary)
        .unwrap_or_else(|| panic!("a row for {summary}"))
}

#[test]
fn graph_row_of_finds_a_commits_row_in_the_windows_layout_and_says_none_for_one_not_there() {
    let (dir, _) = repository_with_commits();
    let window = value(call(
        "graphWindow",
        json!({ "repository": dir.path(), "start": 0 }),
    ));
    let third = window["rows"][2]["id"].clone();

    let found = value(call(
        "graphRowOf",
        json!({ "repository": dir.path(), "commit": third }),
    ));
    assert_eq!(found, json!({ "layout": window["layout"], "row": 2 }));

    let missing = value(call(
        "graphRowOf",
        json!({ "repository": dir.path(), "commit": "0".repeat(40) }),
    ));
    assert_eq!(missing["row"], Value::Null);
    let email = &window["rows"][0]["email"];
    assert_eq!(
        email, "tests@lanewise.invalid",
        "each row has its author's email"
    );
}

#[test]
fn a_graph_window_lays_out_a_merged_branch_beside_main_with_its_lines_named() {
    let (dir, _) = repository_with_commits();
    git_output(dir.path(), &["switch", "--quiet", "-c", "feature/x"]);
    commit(dir.path(), "Feature");
    git_output(dir.path(), &["switch", "--quiet", "main"]);
    commit(dir.path(), "Sixth");
    git_output(
        dir.path(),
        &[
            "merge",
            "--quiet",
            "--no-ff",
            "-m",
            "Merge feature/x",
            "feature/x",
        ],
    );

    let window = value(call(
        "graphWindow",
        json!({ "repository": dir.path(), "start": 0 }),
    ));

    assert_eq!(window["total"], 8);
    assert_eq!(window["start"], 0);
    assert_eq!(window["rows"].as_array().expect("rows").len(), 8);
    assert!(window["layout"].is_string());
    let merge = row(&window, "Merge feature/x");
    assert_eq!(window["rows"][0], *merge, "the merge is at the top");
    assert_eq!(merge["node"], 0);
    assert_eq!(merge["colour"], 0, "HEAD's line is the first lane colour");
    assert_eq!(merge["line"], "main");
    assert_eq!(merge["merged"], json!(["feature/x"]));
    assert_eq!(
        merge["labels"],
        json!([{ "kind": "currentBranch", "name": "main" }])
    );
    let feature = row(&window, "Feature");
    assert_eq!(feature["node"], 1);
    assert_eq!(feature["line"], "feature/x");
    assert_eq!(feature["merged"], json!([]));
    assert_ne!(feature["colour"], merge["colour"]);
    let fifth = row(&window, "Fifth");
    assert_eq!(fifth["node"], 0);
    assert_eq!(fifth["line"], "main");
    assert_eq!(fifth["branchesOff"], json!(["feature/x"]));
    assert_eq!(row(&window, "First")["farParents"], json!([]));
    let segments = window["segments"].as_array().expect("segments");
    assert_eq!(segments.len() % 7, 0, "seven numbers a segment");
    assert!(!segments.is_empty());

    let part = value(call(
        "graphWindow",
        json!({ "repository": dir.path(), "layout": window["layout"], "start": 6, "count": 5 }),
    ));
    assert_eq!(part["layout"], window["layout"]);
    assert_eq!(part["start"], 6);
    assert_eq!(part["rows"].as_array().expect("rows").len(), 2);
    assert_eq!(part["rows"][1]["summary"], "First");
}

#[test]
fn a_graph_window_of_a_layout_the_refs_have_moved_on_from_fails_as_stale() {
    let (dir, _) = repository_with_commits();
    let before = value(call(
        "graphWindow",
        json!({ "repository": dir.path(), "start": 0 }),
    ));

    commit(dir.path(), "Sixth");

    assert_eq!(
        error(call(
            "graphWindow",
            json!({ "repository": dir.path(), "layout": before["layout"], "start": 0 }),
        )),
        json!({ "kind": "staleLayout" })
    );
    let after = value(call(
        "graphWindow",
        json!({ "repository": dir.path(), "start": 0 }),
    ));
    assert_ne!(after["layout"], before["layout"]);
    assert_eq!(after["total"], 6);
    assert_eq!(after["rows"][0]["summary"], "Sixth");
}

#[test]
fn an_empty_repository_has_an_empty_graph_and_a_window_past_the_end_is_empty() {
    let empty = repository_with_untracked_files(0);
    let window = value(call(
        "graphWindow",
        json!({ "repository": empty.path(), "start": 0 }),
    ));
    assert_eq!(window["total"], 0);
    assert_eq!(window["rows"], json!([]));
    assert_eq!(window["segments"], json!([]));

    let (dir, _) = repository_with_commits();
    let past = value(call(
        "graphWindow",
        json!({ "repository": dir.path(), "start": 40 }),
    ));
    assert_eq!(past["total"], 5);
    assert_eq!(past["start"], 40);
    assert_eq!(past["rows"], json!([]));
}

#[test]
fn reads_a_changed_files_diff_as_unified_diff_lines() {
    let dir = repository_with_untracked_files(0);
    fs::write(dir.path().join("notes.txt"), "one\ntwo\nthree").expect("the file is written");
    commit(dir.path(), "Add notes");
    fs::write(dir.path().join("notes.txt"), "one\n2\nthree\n").expect("the file is written");
    let changed = commit(dir.path(), "Change notes");

    assert_eq!(
        value(call(
            "commitFileDiff",
            json!({ "repository": dir.path(), "commit": changed, "path": "notes.txt" })
        )),
        json!({
            "old": { "path": "notes.txt", "mode": "file" },
            "new": { "path": "notes.txt", "mode": "file" },
            "content": {
                "kind": "text",
                "hunks": [{
                    "oldStart": 1,
                    "oldLines": 3,
                    "newStart": 1,
                    "newLines": 3,
                    "lines": [
                        " one",
                        "-two",
                        "-three",
                        "\\ No newline at end of file",
                        "+2",
                        "+three",
                    ],
                }],
            },
        })
    );
}

#[test]
fn a_diff_over_the_limit_is_only_counted_until_asked_for_with_a_higher_one() {
    let dir = repository_with_untracked_files(0);
    let lines: String = (0..10).map(|n| format!("line {n}\n")).collect();
    fs::write(dir.path().join("long.txt"), lines).expect("the file is written");
    let added = commit(dir.path(), "Add a long file");
    let request = |limit: u32| json!({ "repository": dir.path(), "commit": added, "path": "long.txt", "limit": limit });

    assert_eq!(
        value(call("commitFileDiff", request(9)))["content"],
        json!({ "kind": "tooLarge", "lines": 10, "added": 10, "removed": 0, "showable": true })
    );
    assert_eq!(
        value(call("commitFileDiff", request(10)))["content"]["hunks"][0]["newLines"],
        json!(10)
    );
}

#[test]
fn a_renamed_files_diff_is_against_where_it_was() {
    let dir = repository_with_untracked_files(0);
    fs::write(dir.path().join("old.txt"), "same\n").expect("the file is written");
    commit(dir.path(), "Add old");
    fs::rename(dir.path().join("old.txt"), dir.path().join("new.txt")).expect("the file moves");
    let renamed = commit(dir.path(), "Rename it");

    assert_eq!(
        value(call(
            "commitFileDiff",
            json!({ "repository": dir.path(), "commit": renamed, "path": "new.txt", "from": "old.txt" })
        )),
        json!({
            "old": { "path": "old.txt", "mode": "file" },
            "new": { "path": "new.txt", "mode": "file" },
            "content": { "kind": "text", "hunks": [] },
        })
    );
}

#[test]
fn a_diff_of_a_file_or_commit_that_is_not_there_is_not_found() {
    let (dir, ids) = repository_with_commits();

    assert_eq!(
        error(call(
            "commitFileDiff",
            json!({ "repository": dir.path(), "commit": ids[0], "path": "Second.txt" })
        )),
        json!({ "kind": "fileNotFound", "commit": ids[0], "path": "Second.txt" })
    );
    assert_eq!(
        error(call(
            "commitFileDiff",
            json!({ "repository": dir.path(), "commit": "HEAD", "path": "First.txt" })
        )),
        json!({ "kind": "commitNotFound", "commit": "HEAD" })
    );
}

/// A new repository whose own settings commit as a test identity, whatever
/// the machine's are, since `commit` runs the `git` the user's would.
fn repository_to_commit_in() -> TempDir {
    let dir = repository_with_untracked_files(0);
    for (key, value) in [
        ("user.name", "Lanewise Tests"),
        ("user.email", "tests@lanewise.invalid"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
        ("core.hooksPath", ".git/hooks"),
    ] {
        run_git(dir.path(), &["config", key, value]);
    }
    dir
}

/// Each status entry as `path`, `staged` and its change's `kind`.
fn status(dir: &Path) -> Vec<(String, bool, String)> {
    value(call("fileStatus", json!({ "repository": dir })))["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|item| {
            (
                item["path"].as_str().expect("a path").to_owned(),
                item["staged"].as_bool().expect("staged"),
                item["change"]["kind"].as_str().expect("a kind").to_owned(),
            )
        })
        .collect()
}

fn entry(path: &str, staged: bool, kind: &str) -> (String, bool, String) {
    (path.into(), staged, kind.into())
}

#[test]
fn stages_and_unstages_files_by_path_and_all_at_once() {
    support::git();
    let dir = repository_to_commit_in();
    fs::write(dir.path().join("a.txt"), "a").expect("the file is written");
    fs::write(dir.path().join("b.txt"), "b").expect("the file is written");

    assert_eq!(
        value(call(
            "stageFiles",
            json!({ "repository": dir.path(), "files": { "kind": "paths", "paths": ["a.txt"] } })
        )),
        Value::Null
    );
    assert_eq!(
        status(dir.path()),
        [
            entry("a.txt", true, "added"),
            entry("b.txt", false, "untracked")
        ]
    );

    value(call(
        "stageFiles",
        json!({ "repository": dir.path(), "files": { "kind": "all" } }),
    ));
    assert_eq!(
        status(dir.path()),
        [entry("a.txt", true, "added"), entry("b.txt", true, "added")]
    );

    value(call(
        "unstageFiles",
        json!({ "repository": dir.path(), "files": { "kind": "paths", "paths": ["b.txt"] } }),
    ));
    assert_eq!(
        status(dir.path()),
        [
            entry("a.txt", true, "added"),
            entry("b.txt", false, "untracked")
        ]
    );

    value(call(
        "unstageFiles",
        json!({ "repository": dir.path(), "files": { "kind": "all" } }),
    ));
    assert_eq!(
        status(dir.path()),
        [
            entry("a.txt", false, "untracked"),
            entry("b.txt", false, "untracked")
        ]
    );
}

#[test]
fn staging_a_file_that_is_not_there_is_git_s_error() {
    support::git();
    let dir = repository_to_commit_in();

    let failed = error(call(
        "stageFiles",
        json!({ "repository": dir.path(), "files": { "kind": "paths", "paths": ["gone.txt"] } }),
    ));

    assert_eq!(failed["kind"], "gitFailed", "{failed}");
    assert!(
        failed["message"]
            .as_str()
            .expect("a message")
            .contains("gone.txt"),
        "{failed}"
    );
}

#[test]
fn commits_the_staged_changes_amends_them_and_the_history_shows_it() {
    support::git();
    let dir = repository_to_commit_in();
    assert_eq!(
        value(call("lastCommit", json!({ "repository": dir.path() }))),
        Value::Null
    );
    assert_eq!(
        error(call(
            "commit",
            json!({ "repository": dir.path(), "message": "Add nothing" })
        )),
        json!({ "kind": "nothingStaged" })
    );

    fs::write(dir.path().join("a.txt"), "a").expect("the file is written");
    value(call(
        "stageFiles",
        json!({ "repository": dir.path(), "files": { "kind": "all" } }),
    ));
    let committed = value(call(
        "commit",
        json!({ "repository": dir.path(), "message": "Add a\n\nIt was missing." }),
    ));

    assert_eq!(
        committed["id"],
        json!(git_output(dir.path(), &["rev-parse", "HEAD"]))
    );
    assert!(
        committed["id"]
            .as_str()
            .expect("an id")
            .starts_with(committed["shortId"].as_str().expect("a short id")),
        "{committed}"
    );
    assert_eq!(committed["messages"], "");
    assert_eq!(status(dir.path()), []);
    let (summaries, _) = read_history(dir.path(), 10);
    assert_eq!(summaries[0]["summary"], "Add a");
    assert_eq!(
        value(call("lastCommit", json!({ "repository": dir.path() }))),
        json!({
            "id": committed["id"],
            "shortId": committed["shortId"],
            "subject": "Add a",
            "body": "It was missing.",
            "pushedTo": [],
        })
    );

    fs::write(dir.path().join("b.txt"), "b").expect("the file is written");
    value(call(
        "stageFiles",
        json!({ "repository": dir.path(), "files": { "kind": "all" } }),
    ));
    let amended = value(call(
        "commit",
        json!({ "repository": dir.path(), "message": "Add a and b", "amend": true }),
    ));

    assert_ne!(amended["id"], committed["id"]);
    let (summaries, _) = read_history(dir.path(), 10);
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0]["summary"], "Add a and b");
    assert_eq!(
        git_output(dir.path(), &["show", "--name-only", "--format=", "HEAD"]),
        "a.txt\nb.txt"
    );
}

#[test]
fn a_pushed_last_commit_says_where_it_was_pushed() {
    support::git();
    let dir = repository_to_commit_in();
    fs::write(dir.path().join("a.txt"), "a").expect("the file is written");
    commit(dir.path(), "Add a");
    let remote = tempfile::tempdir().expect("a temporary folder");
    run_git(remote.path(), &["init", "--quiet", "--bare"]);
    run_git(
        dir.path(),
        &[
            "remote",
            "add",
            "origin",
            remote.path().to_str().expect("UTF-8"),
        ],
    );
    run_git(dir.path(), &["push", "--quiet", "origin", "main"]);

    assert_eq!(
        value(call("lastCommit", json!({ "repository": dir.path() })))["pushedTo"],
        json!(["origin/main"])
    );
}

#[test]
fn a_failing_pre_commit_hook_fails_the_commit_with_what_it_wrote() {
    support::git();
    let dir = repository_to_commit_in();
    fs::write(dir.path().join("a.txt"), "a \n").expect("the file is written");
    value(call(
        "stageFiles",
        json!({ "repository": dir.path(), "files": { "kind": "all" } }),
    ));
    let hook = dir.path().join(".git/hooks/pre-commit");
    fs::create_dir_all(hook.parent().expect("a parent")).expect("the hooks folder is made");
    fs::write(
        &hook,
        "#!/bin/sh\necho 'lint: a.txt:1 has trailing whitespace'\nexit 1\n",
    )
    .expect("the hook is written");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).expect("it runs");
    }

    let failed = error(call(
        "commit",
        json!({ "repository": dir.path(), "message": "Add a" }),
    ));

    assert_eq!(failed["kind"], "gitFailed", "{failed}");
    assert_eq!(failed["code"], 1);
    assert_eq!(failed["message"], "lint: a.txt:1 has trailing whitespace");
    assert_eq!(status(dir.path()), [entry("a.txt", true, "added")]);
}

#[test]
fn reads_a_changed_files_staged_and_unstaged_diffs() {
    support::git();
    let dir = repository_to_commit_in();
    fs::write(dir.path().join("notes.txt"), "one\n").expect("the file is written");
    commit(dir.path(), "Add notes");
    fs::write(dir.path().join("notes.txt"), "one\ntwo\n").expect("the file is written");
    value(call(
        "stageFiles",
        json!({ "repository": dir.path(), "files": { "kind": "all" } }),
    ));
    fs::write(dir.path().join("notes.txt"), "one\ntwo\nthree\n").expect("the file is written");
    let diff = |staged: bool| {
        value(call(
            "workingTreeFileDiff",
            json!({ "repository": dir.path(), "path": "notes.txt", "staged": staged }),
        ))["content"]["hunks"][0]["lines"]
            .clone()
    };

    assert_eq!(diff(true), json!([" one", "+two"]));
    assert_eq!(diff(false), json!([" one", " two", "+three"]));
    assert_eq!(
        error(call(
            "workingTreeFileDiff",
            json!({ "repository": dir.path(), "path": "other.txt", "staged": true })
        )),
        json!({ "kind": "changeNotFound", "path": "other.txt" })
    );
}

/// The hunks of `path`'s working tree diff, staged or not, as sent.
fn hunks(dir: &Path, path: &str, staged: bool) -> Vec<Value> {
    value(call(
        "workingTreeFileDiff",
        json!({ "repository": dir, "path": path, "staged": staged }),
    ))["content"]["hunks"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

/// What the index has of `path`.
fn staged_text(dir: &Path, path: &str) -> String {
    let output = support::git()
        .current_dir(dir)
        .args(["show", &format!(":{path}")])
        .output()
        .expect("git runs");
    assert!(output.status.success(), "{path} is in the index");
    String::from_utf8(output.stdout).expect("UTF-8")
}

#[test]
fn stages_and_unstages_single_hunks_sent_back_as_the_diff_sent_them() {
    support::git();
    let dir = repository_to_commit_in();
    let lines: Vec<String> = (1..=20).map(|n| format!("line {n}\r\n")).collect();
    fs::write(dir.path().join("notes.txt"), lines.concat()).expect("the file is written");
    commit(dir.path(), "Notes");
    let mut changed = lines.clone();
    changed[1] = "two\r\n".into();
    changed[10] = "eleven\r\n".into();
    changed[19] = "twenty".into();
    fs::write(dir.path().join("notes.txt"), changed.concat()).expect("the file is written");

    let unstaged = hunks(dir.path(), "notes.txt", false);
    assert_eq!(unstaged.len(), 3, "{unstaged:?}");
    assert_eq!(
        value(call(
            "stageHunk",
            json!({ "repository": dir.path(), "path": "notes.txt", "hunk": unstaged[2] }),
        )),
        Value::Null
    );
    let mut expected = lines.clone();
    expected[19] = "twenty".into();
    assert_eq!(staged_text(dir.path(), "notes.txt"), expected.concat());
    assert_eq!(hunks(dir.path(), "notes.txt", false).len(), 2);

    value(call(
        "stageHunk",
        json!({ "repository": dir.path(), "path": "notes.txt", "hunk": unstaged[0] }),
    ));
    expected[1] = "two\r\n".into();
    assert_eq!(staged_text(dir.path(), "notes.txt"), expected.concat());

    let staged = hunks(dir.path(), "notes.txt", true);
    assert_eq!(staged.len(), 2, "{staged:?}");
    value(call(
        "unstageHunk",
        json!({ "repository": dir.path(), "path": "notes.txt", "hunk": staged[1] }),
    ));
    expected[19] = lines[19].clone();
    assert_eq!(staged_text(dir.path(), "notes.txt"), expected.concat());
    assert_eq!(
        fs::read_to_string(dir.path().join("notes.txt")).expect("the file is read"),
        changed.concat(),
        "the working tree keeps every change"
    );
    assert_eq!(
        status(dir.path()),
        [
            entry("notes.txt", true, "modified"),
            entry("notes.txt", false, "modified")
        ]
    );
}

#[test]
fn a_hunk_the_file_no_longer_has_is_not_found_and_nothing_is_staged() {
    support::git();
    let dir = repository_to_commit_in();
    fs::write(dir.path().join("a.txt"), "one\n").expect("the file is written");
    commit(dir.path(), "A");
    fs::write(dir.path().join("a.txt"), "two\n").expect("the file is written");
    let hunk = hunks(dir.path(), "a.txt", false).remove(0);
    fs::write(dir.path().join("a.txt"), "three\n").expect("the file is written");

    assert_eq!(
        error(call(
            "stageHunk",
            json!({ "repository": dir.path(), "path": "a.txt", "hunk": hunk }),
        )),
        json!({ "kind": "hunkNotFound", "path": "a.txt" })
    );
    assert_eq!(staged_text(dir.path(), "a.txt"), "one\n");
    assert_eq!(
        error(call(
            "unstageHunk",
            json!({ "repository": dir.path(), "path": "a.txt", "hunk": hunk }),
        )),
        json!({ "kind": "hunkNotFound", "path": "a.txt" })
    );
}

#[test]
fn a_hunk_whose_lines_are_not_a_diff_s_is_an_invalid_request() {
    let dir = repository_to_commit_in();
    let reply = serde_json::to_value(call(
        "stageHunk",
        json!({
            "repository": dir.path(),
            "path": "a.txt",
            "hunk": { "oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1, "lines": ["one"] },
        }),
    ))
    .unwrap();

    assert_eq!(reply["outcome"], "rejected", "{reply}");
    assert_eq!(reply["rejection"]["kind"], "invalidRequest", "{reply}");
}

#[test]
fn working_tree_changes_answers_once_a_file_changes() {
    let dir = repository_with_untracked_files(0);
    let request = |seen: Option<u64>| json!({ "repository": dir.path(), "seen": seen });
    let first = value(call("workingTreeChanges", request(None)))["generation"]
        .as_u64()
        .expect("a generation");

    let writer = std::thread::spawn({
        let path = dir.path().join("new.txt");
        move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            fs::write(path, "new").expect("the file is written");
        }
    });
    let next = value(call("workingTreeChanges", request(Some(first))))["generation"]
        .as_u64()
        .expect("a generation");
    writer.join().expect("the writer finishes");

    assert_ne!(next, first);
}

/// The local branches as `branches` lists them, each as its name and
/// whether it's the current branch.
fn local_branches(dir: &Path) -> Vec<(String, bool)> {
    value(call("branches", json!({ "repository": dir })))["local"]
        .as_array()
        .expect("local branches")
        .iter()
        .map(|branch| {
            (
                branch["name"].as_str().expect("a name").to_owned(),
                branch["current"].as_bool().expect("current"),
            )
        })
        .collect()
}

fn branch(name: &str, current: bool) -> (String, bool) {
    (name.into(), current)
}

#[test]
fn lists_branches_by_kind_and_remote_and_the_graph_labels_one_made_at_a_commit() {
    let (dir, ids) = repository_with_commits();
    git_output(
        dir.path(),
        &["update-ref", "refs/remotes/origin/main", &ids[4]],
    );
    git_output(dir.path(), &["tag", "v1.0", &ids[0]]);

    assert_eq!(
        value(call(
            "createBranch",
            json!({ "repository": dir.path(), "name": "feature/second", "start": ids[1] })
        )),
        Value::Null
    );

    assert_eq!(
        value(call("branches", json!({ "repository": dir.path() }))),
        json!({
            "local": [
                { "name": "feature/second", "commit": ids[1], "current": false, "upstream": null },
                { "name": "main", "commit": ids[4], "current": true, "upstream": null },
            ],
            // Only a remote-tracking branch, with no remote in the config.
            "remotes": [{
                "name": "origin",
                "url": null,
                "pushUrl": null,
                "configured": false,
                "branches": [{ "name": "origin/main", "branch": "main", "commit": ids[4] }],
            }],
            "tags": [{ "name": "v1.0", "commit": ids[0] }],
            "detached": null,
        })
    );
    let window = value(call(
        "graphWindow",
        json!({ "repository": dir.path(), "start": 0 }),
    ));
    assert_eq!(
        row(&window, "Second")["labels"],
        json!([{ "kind": "branch", "name": "feature/second" }])
    );
}

#[test]
fn a_branch_name_git_does_not_allow_or_a_commit_not_there_fails_saying_which() {
    let (dir, _) = repository_with_commits();

    assert_eq!(
        error(call(
            "createBranch",
            json!({ "repository": dir.path(), "name": "two words" })
        )),
        json!({ "kind": "invalidName", "name": "two words" })
    );
    assert_eq!(
        error(call(
            "createBranch",
            json!({ "repository": dir.path(), "name": "main" })
        )),
        json!({ "kind": "alreadyExists", "name": "main" })
    );
    let missing = "0123456789abcdef0123456789abcdef01234567";
    assert_eq!(
        error(call(
            "createBranch",
            json!({ "repository": dir.path(), "name": "x", "start": missing })
        )),
        json!({ "kind": "commitNotFound", "commit": missing })
    );
    assert_eq!(local_branches(dir.path()), [branch("main", true)]);
}

#[test]
fn renames_and_deletes_a_branch_confirming_the_commits_only_it_has() {
    let (dir, ids) = repository_with_commits();
    git_output(dir.path(), &["switch", "--quiet", "-c", "feature"]);
    fs::write(dir.path().join("Sixth.txt"), "Sixth").unwrap();
    let sixth = commit(dir.path(), "Sixth");
    git_output(dir.path(), &["switch", "--quiet", "main"]);

    assert_eq!(
        value(call(
            "renameBranch",
            json!({ "repository": dir.path(), "from": "feature", "to": "feature/sixth" })
        )),
        Value::Null
    );
    assert_eq!(
        error(call(
            "deleteBranch",
            json!({ "repository": dir.path(), "name": "main" })
        )),
        json!({ "kind": "isCurrent", "name": "main" })
    );

    let unmerged = error(call(
        "deleteBranch",
        json!({ "repository": dir.path(), "name": "feature/sixth" }),
    ));
    assert_eq!(
        unmerged,
        json!({
            "kind": "unmerged",
            "name": "feature/sixth",
            "tip": sixth,
            "count": 1,
            "commits": [{
                "id": sixth,
                "shortId": &sixth[..7],
                "summary": "Sixth",
                "author": "Lanewise Tests",
                "email": "tests@lanewise.invalid",
                "time": 1000,
                "labels": [],
            }],
        })
    );
    // A confirmation for another tip confirms nothing.
    assert_eq!(
        error(call(
            "deleteBranch",
            json!({ "repository": dir.path(), "name": "feature/sixth", "confirmedTip": ids[4] })
        ))["kind"],
        "unmerged"
    );
    assert_eq!(
        value(call(
            "deleteBranch",
            json!({ "repository": dir.path(), "name": "feature/sixth", "confirmedTip": sixth })
        )),
        Value::Null
    );
    assert_eq!(local_branches(dir.path()), [branch("main", true)]);
    assert_eq!(
        error(call(
            "renameBranch",
            json!({ "repository": dir.path(), "from": "feature/sixth", "to": "back" })
        )),
        json!({ "kind": "branchNotFound", "name": "feature/sixth" })
    );
}

#[test]
fn checking_out_over_changes_it_would_overwrite_names_them_or_stashes_them_first() {
    let dir = repository_to_commit_in();
    fs::write(dir.path().join("a.txt"), "a\n").unwrap();
    commit(dir.path(), "First");
    git_output(dir.path(), &["switch", "--quiet", "-c", "feature"]);
    fs::write(dir.path().join("a.txt"), "feature\n").unwrap();
    commit(dir.path(), "Change a");
    git_output(dir.path(), &["switch", "--quiet", "main"]);
    fs::write(dir.path().join("a.txt"), "mine\n").unwrap();
    let request = |stash_first: bool| {
        json!({
            "repository": dir.path(),
            "branch": { "kind": "local", "name": "feature" },
            "stashFirst": stash_first,
        })
    };

    assert_eq!(
        error(call("checkOut", request(false))),
        json!({ "kind": "wouldOverwrite", "paths": ["a.txt"] })
    );
    assert_eq!(local_branches(dir.path())[1], branch("main", true));

    let stash = "Lanewise: uncommitted changes before checking out feature";
    assert_eq!(
        value(call("checkOut", request(true))),
        json!({ "branch": "feature", "stash": stash })
    );
    assert_eq!(
        local_branches(dir.path()),
        [branch("feature", true), branch("main", false)]
    );
    assert_eq!(status(dir.path()), []);
}

#[test]
fn checking_out_a_remote_tracking_branch_makes_a_local_one() {
    let (dir, ids) = repository_with_commits();
    git_output(dir.path(), &["config", "remote.origin.url", "."]);
    git_output(
        dir.path(),
        &[
            "config",
            "remote.origin.fetch",
            "+refs/heads/*:refs/remotes/origin/*",
        ],
    );
    git_output(
        dir.path(),
        &["update-ref", "refs/remotes/origin/topic", &ids[2]],
    );

    assert_eq!(
        value(call(
            "checkOut",
            json!({ "repository": dir.path(), "branch": { "kind": "remote", "name": "origin/topic" } })
        )),
        json!({ "branch": "topic", "stash": null })
    );
    assert_eq!(
        local_branches(dir.path()),
        [branch("main", false), branch("topic", true)]
    );
}

#[test]
fn checking_out_a_branch_at_its_remote_tracking_branch_moves_it_there() {
    let (dir, ids) = repository_with_commits();
    git_output(dir.path(), &["config", "remote.origin.url", "."]);
    git_output(
        dir.path(),
        &[
            "config",
            "remote.origin.fetch",
            "+refs/heads/*:refs/remotes/origin/*",
        ],
    );
    git_output(
        dir.path(),
        &["update-ref", "refs/remotes/origin/main", &ids[2]],
    );

    assert_eq!(
        value(call(
            "checkOut",
            json!({
                "repository": dir.path(),
                "branch": { "kind": "localAt", "name": "main", "at": "origin/main" }
            })
        )),
        json!({ "branch": "main", "stash": null })
    );
    assert_eq!(
        git_output(dir.path(), &["rev-parse", "main"]).trim(),
        ids[2]
    );
    assert_eq!(
        error(call(
            "checkOut",
            json!({
                "repository": dir.path(),
                "branch": { "kind": "localAt", "name": "main", "at": "origin/gone" }
            })
        )),
        json!({ "kind": "branchNotFound", "name": "origin/gone" })
    );
}

#[test]
fn a_repository_s_web_page_and_pull_requests_come_from_its_remote() {
    let (dir, _) = repository_with_commits();
    assert_eq!(
        error(call("pullRequests", json!({ "repository": dir.path() }))),
        json!({ "kind": "noHost" })
    );

    git_output(
        dir.path(),
        &[
            "remote",
            "add",
            "origin",
            "https://git.example.com/team/lanewise.git",
        ],
    );
    let opened = value(call("openRepository", json!({ "path": dir.path() })));
    assert_eq!(
        opened["web"],
        json!({
            "url": "https://git.example.com/team/lanewise",
            "host": "git.example.com",
            "integration": "generic"
        })
    );
    // Only GitHub's Host Integration reads them, and nothing is sent to the Host.
    assert_eq!(
        error(call("pullRequests", json!({ "repository": dir.path() }))),
        json!({ "kind": "notOffered", "host": "git.example.com", "tier": 1 })
    );

    git_output(
        dir.path(),
        &[
            "remote",
            "set-url",
            "origin",
            "git@github.com:adrianeyre/lanewise.git",
        ],
    );
    assert_eq!(
        value(call("openRepository", json!({ "path": dir.path() })))["web"],
        json!({
            "url": "https://github.com/adrianeyre/lanewise",
            "host": "github.com",
            "integration": "github"
        })
    );
}

/// A repository to merge in, committing as the test identity: `main` with
/// one commit, and `feature` with two more on top of it.
fn repository_to_merge_in() -> (TempDir, String, String) {
    let dir = repository_to_commit_in();
    fs::write(dir.path().join("a.txt"), "a\n").expect("the file is written");
    let base = commit(dir.path(), "First");
    git_output(dir.path(), &["switch", "--quiet", "-c", "feature"]);
    fs::write(dir.path().join("b.txt"), "b\n").expect("the file is written");
    commit(dir.path(), "Add b");
    fs::write(dir.path().join("a.txt"), "theirs\n").expect("the file is written");
    let tip = commit(dir.path(), "Change a");
    git_output(dir.path(), &["switch", "--quiet", "main"]);
    (dir, base, tip)
}

fn preview_merge(dir: &Path, name: &str) -> Reply {
    call(
        "previewMerge",
        json!({ "repository": dir, "branch": { "kind": "local", "name": name } }),
    )
}

/// Merges `name` into `HEAD`, as `preview` had them.
fn merge(dir: &Path, name: &str, preview: &Value) -> Reply {
    call(
        "merge",
        json!({
            "repository": dir,
            "branch": { "kind": "local", "name": name },
            "head": preview["head"],
            "tip": preview["tip"],
        }),
    )
}

#[test]
fn a_branch_ahead_previews_and_merges_as_a_fast_forward() {
    let (dir, base, tip) = repository_to_merge_in();

    let preview = value(preview_merge(dir.path(), "feature"));

    assert_eq!(
        preview,
        json!({ "into": "main", "head": base, "tip": tip, "commits": 2, "kind": "fastForward" })
    );
    assert_eq!(
        value(merge(dir.path(), "feature", &preview)),
        json!({ "kind": "fastForward", "commits": 2 })
    );
    assert_eq!(git_output(dir.path(), &["rev-parse", "HEAD"]), tip);
}

#[test]
fn diverged_branches_or_merge_ff_false_merge_in_a_merge_commit() {
    let (dir, _, tip) = repository_to_merge_in();
    run_git(dir.path(), &["config", "merge.ff", "false"]);

    let preview = value(preview_merge(dir.path(), "feature"));

    assert_eq!(preview["kind"], "mergeCommit");
    assert_eq!(preview["insteadOfFastForward"], true);
    let merged = value(merge(dir.path(), "feature", &preview));
    assert_eq!(merged["kind"], "mergeCommit", "{merged}");
    assert_eq!(merged["commits"], 2);
    assert_eq!(
        merged["commit"],
        json!(git_output(dir.path(), &["rev-parse", "HEAD"]))
    );
    assert_eq!(
        git_output(dir.path(), &["rev-parse", "HEAD^2"]),
        tip,
        "the branch's tip is the merge commit's second parent"
    );

    run_git(dir.path(), &["config", "merge.ff", "only"]);
    fs::write(dir.path().join("c.txt"), "c\n").expect("the file is written");
    commit(dir.path(), "Add c");
    let preview = value(preview_merge(dir.path(), "feature"));
    assert_eq!(preview["kind"], "upToDate");
}

#[test]
fn a_merge_whose_branch_moved_since_its_preview_sends_the_new_preview() {
    let (dir, _, tip) = repository_to_merge_in();
    let stale = json!({ "head": tip, "tip": tip });

    let moved = error(merge(dir.path(), "feature", &stale));

    assert_eq!(moved["kind"], "moved", "{moved}");
    assert_eq!(moved["preview"]["commits"], 2);
    assert_eq!(moved["preview"]["kind"], "fastForward");
    assert_eq!(
        error(merge(
            dir.path(),
            "feature",
            &json!({ "head": "HEAD", "tip": "x" })
        ))["kind"],
        "moved"
    );
    assert_eq!(
        error(preview_merge(dir.path(), "gone")),
        json!({ "kind": "branchNotFound", "name": "gone" })
    );
}

#[test]
fn a_merge_that_conflicts_stops_in_progress_until_it_is_aborted() {
    let (dir, _, tip) = repository_to_merge_in();
    fs::write(dir.path().join("a.txt"), "ours\n").expect("the file is written");
    let main = commit(dir.path(), "Change a here too");
    let in_progress = || value(call("mergeInProgress", json!({ "repository": dir.path() })));
    assert_eq!(in_progress(), Value::Null);

    let preview = value(preview_merge(dir.path(), "feature"));
    let merged = value(merge(dir.path(), "feature", &preview));

    assert_eq!(merged["kind"], "stopped", "{merged}");
    assert_eq!(merged["conflicts"], json!(["a.txt"]));
    let stopped = in_progress();
    assert_eq!(stopped["into"], "main");
    assert_eq!(stopped["conflicts"], json!(["a.txt"]));
    assert_eq!(stopped["merging"][0]["id"], json!(tip));
    assert_eq!(stopped["merging"][0]["summary"], "Change a");
    assert_eq!(
        stopped["merging"][0]["labels"],
        json!([{ "kind": "branch", "name": "feature" }])
    );
    assert_eq!(
        error(preview_merge(dir.path(), "feature")),
        json!({ "kind": "mergeInProgress" })
    );

    assert_eq!(
        value(call("abortMerge", json!({ "repository": dir.path() }))),
        Value::Null
    );

    assert_eq!(in_progress(), Value::Null);
    assert_eq!(git_output(dir.path(), &["rev-parse", "HEAD"]), main);
    assert_eq!(status(dir.path()), []);
    assert_eq!(
        error(call("abortMerge", json!({ "repository": dir.path() }))),
        json!({ "kind": "notMerging" })
    );
}

#[test]
fn a_merge_that_conflicts_is_continued_once_its_files_are_marked_resolved() {
    let (dir, _, tip) = repository_to_merge_in();
    fs::write(dir.path().join("a.txt"), "ours\n").expect("the file is written");
    let main = commit(dir.path(), "Change a here too");
    let preview = value(preview_merge(dir.path(), "feature"));
    value(merge(dir.path(), "feature", &preview));
    let repository = json!({ "repository": dir.path() });
    let files = json!({ "repository": dir.path(), "paths": ["a.txt"] });
    let operation = || value(call("operationInProgress", repository.clone()));

    let stopped = operation();
    assert_eq!(stopped["kind"], "merge", "{stopped}");
    assert_eq!(stopped["into"], "main");
    assert_eq!(stopped["merging"][0]["id"], json!(tip));
    assert_eq!(
        stopped["merging"][0]["labels"],
        json!([{ "kind": "branch", "name": "feature" }])
    );
    assert_eq!(stopped["conflicts"], json!(["a.txt"]));
    assert_eq!(stopped["resolved"], json!([]));
    assert_eq!(
        error(call("continueOperation", repository.clone())),
        json!({ "kind": "unresolved", "conflicts": ["a.txt"] })
    );
    assert_eq!(
        error(call("skipCommit", repository.clone())),
        json!({ "kind": "notRebasing" })
    );

    fs::write(dir.path().join("a.txt"), "both\n").expect("the file is written");
    assert_eq!(value(call("markResolved", files.clone())), Value::Null);
    assert_eq!(operation()["resolved"], json!(["a.txt"]));
    assert_eq!(value(call("markUnresolved", files.clone())), Value::Null);
    assert_eq!(operation()["conflicts"], json!(["a.txt"]));
    assert_eq!(value(call("markResolved", files)), Value::Null);

    assert_eq!(
        value(call("continueOperation", repository.clone())),
        Value::Null
    );

    assert_eq!(operation(), Value::Null);
    assert_eq!(git_output(dir.path(), &["rev-parse", "HEAD^1"]), main);
    assert_eq!(git_output(dir.path(), &["rev-parse", "HEAD^2"]), tip);
    assert_eq!(
        error(call("abortOperation", repository)),
        json!({ "kind": "notInProgress" })
    );
}

#[test]
fn a_conflicted_file_reads_three_ways_and_its_resolution_is_written_and_marked_resolved() {
    let (dir, _, _) = repository_to_merge_in();
    fs::write(dir.path().join("a.txt"), "ours\n").expect("the file is written");
    commit(dir.path(), "Change a here too");
    let preview = value(preview_merge(dir.path(), "feature"));
    value(merge(dir.path(), "feature", &preview));
    let file = |path: &str| {
        call(
            "conflictedFile",
            json!({ "repository": dir.path(), "path": path }),
        )
    };

    let read = value(file("a.txt"));
    assert_eq!(
        read["ours"],
        json!({ "kind": "text", "text": "ours\n" }),
        "{read}"
    );
    assert_eq!(read["theirs"]["kind"], "text");
    assert_eq!(read["base"]["kind"], "text");
    let working = read["working"]["text"]
        .as_str()
        .expect("the working tree's text");
    assert!(working.starts_with("<<<<<<< HEAD\nours\n"), "{working}");
    assert_eq!(read["oursSubject"], "Change a here too");
    assert_eq!(read["theirsSubject"], "Change a");
    assert_eq!(
        error(file("b.txt")),
        json!({ "kind": "notConflicted", "path": "b.txt" })
    );

    let resolve = json!({ "repository": dir.path(), "path": "a.txt", "content": "resolved\n" });
    assert_eq!(value(call("resolveConflict", resolve.clone())), Value::Null);

    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).expect("the file reads"),
        "resolved\n"
    );
    let operation = value(call(
        "operationInProgress",
        json!({ "repository": dir.path() }),
    ));
    assert_eq!(operation["conflicts"], json!([]));
    assert_eq!(operation["resolved"], json!(["a.txt"]));
    assert_eq!(
        error(call("resolveConflict", resolve)),
        json!({ "kind": "notConflicted", "path": "a.txt" })
    );
}

#[test]
fn a_file_deleted_on_one_side_reads_what_git_reports_and_is_resolved_whole() {
    let (dir, _, _) = repository_to_merge_in();
    git_output(dir.path(), &["rm", "--quiet", "a.txt"]);
    commit(dir.path(), "Remove a here");
    let preview = value(preview_merge(dir.path(), "feature"));
    value(merge(dir.path(), "feature", &preview));
    let resolve = |choice: &str| {
        call(
            "resolveWholeFile",
            json!({ "repository": dir.path(), "path": "a.txt", "choice": choice }),
        )
    };

    let read = value(call(
        "conflictedFile",
        json!({ "repository": dir.path(), "path": "a.txt" }),
    ));
    assert_eq!(read["ours"], Value::Null, "{read}");
    assert_eq!(
        read["theirs"],
        json!({ "kind": "text", "text": "theirs\n" })
    );
    assert_eq!(read["reports"][0]["kind"], "modify/delete", "{read}");
    assert_eq!(read["reports"][0]["paths"], json!(["a.txt"]));

    assert_eq!(
        error(resolve("ours")),
        json!({ "kind": "noVersion", "path": "a.txt", "side": "ours" })
    );
    assert_eq!(value(resolve("theirs")), Value::Null);
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).expect("the file reads"),
        "theirs\n"
    );
    let operation = value(call(
        "operationInProgress",
        json!({ "repository": dir.path() }),
    ));
    assert_eq!(operation["conflicts"], json!([]));
    assert_eq!(operation["resolved"], json!(["a.txt"]));
    assert_eq!(
        error(resolve("delete")),
        json!({ "kind": "notConflicted", "path": "a.txt" })
    );
}

/// A repository to stash in, committing as the test identity: `main` with
/// one commit of `a.txt`, changed since, and an untracked `new.txt`.
fn repository_to_stash_in() -> (TempDir, String) {
    let dir = repository_to_commit_in();
    fs::write(dir.path().join("a.txt"), "a\n").expect("the file is written");
    let base = commit(dir.path(), "First");
    fs::write(dir.path().join("a.txt"), "changed\n").expect("the file is written");
    fs::write(dir.path().join("new.txt"), "new\n").expect("the file is written");
    (dir, base)
}

fn stashes(dir: &Path) -> Value {
    value(call("stashes", json!({ "repository": dir })))
}

fn create_stash(dir: &Path, message: Value, include_untracked: bool) -> Reply {
    call(
        "createStash",
        json!({ "repository": dir, "message": message, "includeUntracked": include_untracked }),
    )
}

#[test]
fn makes_a_stash_and_lists_it_with_its_message_branch_and_base() {
    let (dir, base) = repository_to_stash_in();
    assert_eq!(stashes(dir.path()), json!([]));

    let stash = value(create_stash(dir.path(), json!("Half-done"), true));

    assert_eq!(
        stash["id"],
        json!(git_output(dir.path(), &["rev-parse", "stash@{0}"]))
    );
    assert_eq!(stash["index"], 0);
    assert_eq!(stash["message"], "Half-done");
    assert_eq!(stash["branch"], "main");
    assert_eq!(stash["base"]["id"], json!(base));
    assert_eq!(stash["base"]["summary"], "First");
    assert_eq!(stash["untracked"], true);
    assert_eq!(stashes(dir.path()), json!([stash]));
    assert_eq!(status(dir.path()), []);
    assert_eq!(
        value(call(
            "stashChanges",
            json!({ "repository": dir.path(), "stash": stash["id"] })
        ))["items"],
        json!([
            { "path": "a.txt", "change": { "kind": "modified" } },
            { "path": "new.txt", "change": { "kind": "added" } },
        ])
    );
    let diff = value(call(
        "stashFileDiff",
        json!({ "repository": dir.path(), "stash": stash["id"], "path": "a.txt" }),
    ));
    assert_eq!(
        diff["content"]["hunks"][0]["lines"],
        json!(["-a", "+changed"])
    );
    let added = value(call(
        "stashFileDiff",
        json!({ "repository": dir.path(), "stash": stash["id"], "path": "new.txt" }),
    ));
    assert_eq!(added["old"], Value::Null);
}

#[test]
fn a_blank_message_or_none_leaves_the_stash_for_git_to_name_and_untracked_files_stay() {
    let (dir, _) = repository_to_stash_in();

    let stash = value(create_stash(dir.path(), json!("  "), false));

    assert_eq!(stash["message"], Value::Null);
    assert_eq!(stash["untracked"], false);
    assert_eq!(status(dir.path()), [entry("new.txt", false, "untracked")]);
    fs::remove_file(dir.path().join("new.txt")).expect("the file is removed");
    assert_eq!(
        error(create_stash(dir.path(), Value::Null, true)),
        json!({ "kind": "nothingToStash" })
    );
}

#[test]
fn applies_pops_and_drops_a_stash_by_its_id() {
    let (dir, _) = repository_to_stash_in();
    let older = value(create_stash(dir.path(), json!("older"), false));
    fs::write(dir.path().join("a.txt"), "newer\n").expect("the file is written");
    let newer = value(create_stash(dir.path(), json!("newer"), false));
    let id = |stash: &Value| stash["id"].clone();

    assert_eq!(
        value(call(
            "applyStash",
            json!({ "repository": dir.path(), "stash": id(&older) })
        )),
        json!({ "kind": "applied" })
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "changed\n"
    );
    assert_eq!(stashes(dir.path()).as_array().unwrap().len(), 2);

    git_output(dir.path(), &["checkout", "--", "a.txt"]);
    assert_eq!(
        value(call(
            "popStash",
            json!({ "repository": dir.path(), "stash": id(&newer) })
        )),
        json!({ "kind": "applied" })
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "newer\n"
    );
    let left = stashes(dir.path());
    assert_eq!(left[0]["id"], id(&older));
    assert_eq!(left[0]["index"], 0);

    assert_eq!(
        value(call(
            "dropStash",
            json!({ "repository": dir.path(), "stash": id(&older) })
        )),
        Value::Null
    );
    assert_eq!(stashes(dir.path()), json!([]));
    assert_eq!(
        error(call(
            "dropStash",
            json!({ "repository": dir.path(), "stash": id(&older) })
        )),
        json!({ "kind": "stashNotFound", "stash": id(&older) })
    );
    assert_eq!(
        error(call(
            "applyStash",
            json!({ "repository": dir.path(), "stash": "stash@{0}" })
        )),
        json!({ "kind": "stashNotFound", "stash": "stash@{0}" })
    );
}

#[test]
fn a_pop_over_changes_it_would_overwrite_names_them() {
    let (dir, _) = repository_to_stash_in();
    let stash = value(create_stash(dir.path(), Value::Null, false));
    fs::write(dir.path().join("a.txt"), "mine\n").expect("the file is written");

    assert_eq!(
        error(call(
            "popStash",
            json!({ "repository": dir.path(), "stash": stash["id"] })
        )),
        json!({ "kind": "wouldOverwrite", "paths": ["a.txt"] })
    );
    assert_eq!(stashes(dir.path()), json!([stash]));
}

#[test]
fn a_pop_that_conflicts_stops_in_progress_and_keeps_the_stash() {
    let (dir, _) = repository_to_stash_in();
    let stash = value(create_stash(dir.path(), json!("mine"), true));
    fs::write(dir.path().join("a.txt"), "theirs\n").expect("the file is written");
    commit(dir.path(), "Change a another way");
    let in_progress = || {
        value(call(
            "stashApplyInProgress",
            json!({ "repository": dir.path() }),
        ))
    };
    assert_eq!(in_progress(), Value::Null);

    let popped = value(call(
        "popStash",
        json!({ "repository": dir.path(), "stash": stash["id"] }),
    ));

    assert_eq!(popped["kind"], "stopped", "{popped}");
    assert_eq!(popped["conflicts"], json!(["a.txt"]));
    assert_eq!(in_progress(), json!({ "conflicts": ["a.txt"] }));
    assert_eq!(
        value(call("mergeInProgress", json!({ "repository": dir.path() }))),
        Value::Null
    );
    assert_eq!(stashes(dir.path()), json!([stash]));
    assert!(status(dir.path()).contains(&entry("a.txt", false, "conflicted")));
    assert!(status(dir.path()).contains(&entry("new.txt", false, "untracked")));
    assert_eq!(
        error(call(
            "applyStash",
            json!({ "repository": dir.path(), "stash": stash["id"] })
        )),
        json!({ "kind": "inProgress" })
    );

    // Resolved and staged as Git asks, it's in progress until it's
    // continued, which drops the stash, as a pop with no conflicts would.
    fs::write(dir.path().join("a.txt"), "resolved\n").expect("the file is written");
    git_output(dir.path(), &["add", "a.txt"]);

    assert_eq!(in_progress(), json!({ "conflicts": [] }));
    let operation = value(call(
        "operationInProgress",
        json!({ "repository": dir.path() }),
    ));
    assert_eq!(operation["kind"], "stashApply", "{operation}");
    assert_eq!(operation["pop"], true);
    assert_eq!(operation["stash"], stash);
    assert_eq!(operation["conflicts"], json!([]));
    assert_eq!(operation["resolved"], json!(["a.txt"]));

    assert_eq!(
        value(call(
            "continueOperation",
            json!({ "repository": dir.path() })
        )),
        Value::Null
    );

    assert_eq!(in_progress(), Value::Null);
    assert_eq!(stashes(dir.path()), json!([]));
}

/// A bare repository, as a Host has it, of [`repository_with_commits`], and
/// its `file://` URL, which clones through Git's transport, with progress.
fn repository_to_clone() -> (TempDir, String) {
    let (work, _) = repository_with_commits();
    let host = tempfile::tempdir().expect("a temporary folder");
    let bare = host.path().join("lanewise.git");
    run_git(
        host.path(),
        &[
            "clone",
            "--quiet",
            "--bare",
            &work.path().to_string_lossy(),
            &bare.to_string_lossy(),
        ],
    );
    let path = bare.to_string_lossy().replace('\\', "/");
    let url = if path.starts_with('/') {
        format!("file://{path}")
    } else {
        format!("file:///{path}")
    };
    (host, url)
}

/// Starts cloning `url` into `name` in `parent`, and gives the clone.
fn start_clone(url: &str, parent: &Path, name: &str) -> Value {
    let started = value(call(
        "startClone",
        json!({ "url": url, "parent": parent, "name": name }),
    ));
    assert_eq!(started["destination"], json!(parent.join(name)));
    started["clone"].clone()
}

/// Long polls `clone` until it's no longer running, and gives how it
/// finished, and every state it was seen in on the way.
fn wait_for_clone(clone: &Value) -> (Value, Vec<Value>) {
    let mut seen = Value::Null;
    let mut states = Vec::new();
    for _ in 0..1000 {
        let report = value(call(
            "cloneProgress",
            json!({ "clone": clone, "seen": seen }),
        ));
        seen = report["generation"].clone();
        let state = report["state"].clone();
        if state["kind"] != "running" {
            return (state, states);
        }
        states.push(state);
    }
    panic!("the clone didn't finish: {states:#?}");
}

#[test]
fn clones_a_repository_reporting_progress_then_the_repository_to_open() {
    let (_host, url) = repository_to_clone();
    let into = tempfile::tempdir().expect("a temporary folder");

    let clone = start_clone(&url, into.path(), "lanewise");
    let (finished, running) = wait_for_clone(&clone);

    let destination = into.path().join("lanewise");
    assert_eq!(finished["kind"], json!("cloned"), "{finished}");
    let repository = &finished["repository"];
    assert_eq!(repository["name"], json!("lanewise"));
    assert_eq!(
        Path::new(repository["root"].as_str().expect("a root"))
            .canonicalize()
            .unwrap(),
        destination.canonicalize().unwrap()
    );
    assert!(
        running
            .iter()
            .any(|state| state["progress"]["phase"].is_string()),
        "git reported progress: {running:#?}"
    );
    assert!(destination.join("Fifth.txt").is_file());
    let opened = value(call("openRepository", json!({ "path": destination })));
    assert_eq!(opened["name"], json!("lanewise"));
    // Asked again, it says the same.
    assert_eq!(
        value(call("cloneProgress", json!({ "clone": clone })))["state"],
        finished
    );
}

#[test]
fn a_cancelled_clone_stops_and_its_folder_is_removed() {
    let url = stalled::stalled_remote();
    let into = tempfile::tempdir().expect("a temporary folder");
    let destination = into.path().join("lanewise");

    let clone = start_clone(&url, into.path(), "lanewise");
    for _ in 0..1000 {
        if destination.join(".git").is_dir() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(destination.join(".git").is_dir(), "the clone has begun");
    assert_eq!(
        value(call("cloneProgress", json!({ "clone": clone })))["state"]["kind"],
        json!("running")
    );
    assert_eq!(
        value(call("cancelClone", json!({ "clone": clone }))),
        Value::Null
    );
    let (finished, _) = wait_for_clone(&clone);

    assert_eq!(finished, json!({ "kind": "cancelled" }));
    assert!(!destination.exists());
    assert_eq!(fs::read_dir(into.path()).unwrap().count(), 0);
}

#[test]
fn a_clone_that_fails_says_what_git_said_without_the_command() {
    let (host, _) = repository_to_clone();
    let missing = format!(
        "file:///{}",
        host.path()
            .join("missing.git")
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches('/')
    );
    let into = tempfile::tempdir().expect("a temporary folder");

    let (finished, _) = wait_for_clone(&start_clone(&missing, into.path(), "lanewise"));

    assert_eq!(finished["kind"], json!("failed"));
    let error = &finished["error"];
    assert_eq!(error["kind"], json!("gitFailed"));
    assert!(
        error["message"].as_str().unwrap().contains("missing.git"),
        "{error}"
    );
    assert!(error.get("command").is_none(), "{error}");
    assert!(!into.path().join("lanewise").exists());
}

#[test]
fn a_clone_that_cannot_start_fails_saying_why() {
    let (_host, url) = repository_to_clone();
    let into = tempfile::tempdir().expect("a temporary folder");
    fs::create_dir(into.path().join("taken")).unwrap();
    fs::write(into.path().join("taken/notes.txt"), "mine").unwrap();

    for name in ["", "..", "a/b", "a\\b"] {
        assert_eq!(
            error(call(
                "startClone",
                json!({ "url": url, "parent": into.path(), "name": name })
            )),
            json!({ "kind": "invalidName", "name": name })
        );
    }
    let failed = |url: &str, parent: &Path, name: &str| {
        let (finished, _) = wait_for_clone(&start_clone(url, parent, name));
        assert_eq!(finished["kind"], json!("failed"), "{finished}");
        finished["error"].clone()
    };
    assert_eq!(
        failed(&url, into.path(), "taken"),
        json!({ "kind": "destinationExists", "path": into.path().join("taken") })
    );
    assert_eq!(
        failed(" ", into.path(), "lanewise"),
        json!({ "kind": "noUrl" })
    );
    let missing = into.path().join("missing");
    assert_eq!(
        failed(&url, &missing, "lanewise"),
        json!({ "kind": "noParentFolder", "path": missing })
    );
    assert_eq!(
        fs::read_to_string(into.path().join("taken/notes.txt")).unwrap(),
        "mine"
    );
    assert_eq!(
        error(call("cancelClone", json!({ "clone": 0 }))),
        json!({ "kind": "cloneNotFound", "clone": 0 })
    );
    assert_eq!(
        error(call("cloneProgress", json!({ "clone": 0 }))),
        json!({ "kind": "cloneNotFound", "clone": 0 })
    );
}

/// A bare remote of [`repository_with_commits`], and the user's clone of
/// it, whose `main` has `origin/main` as its Upstream.
fn remote_and_clone() -> (TempDir, TempDir) {
    let (host, url) = repository_to_clone();
    let mine = tempfile::tempdir().expect("a temporary folder");
    git_output(mine.path(), &["clone", "--quiet", &url, "."]);
    // A rebasing pull commits, as Lanewise's own `git` does it.
    for (key, value) in [
        ("user.name", "Lanewise Tests"),
        ("user.email", "tests@lanewise.invalid"),
        ("commit.gpgsign", "false"),
    ] {
        git_output(mine.path(), &["config", key, value]);
    }
    (host, mine)
}

/// Commits `message` to the remote, as someone else pushing to it would.
fn push_from_elsewhere(host: &Path, message: &str) {
    let elsewhere = tempfile::tempdir().expect("a temporary folder");
    let bare = host.join("lanewise.git");
    git_output(
        elsewhere.path(),
        &["clone", "--quiet", &bare.to_string_lossy(), "."],
    );
    fs::write(elsewhere.path().join("elsewhere.txt"), message).unwrap();
    commit(elsewhere.path(), message);
    git_output(elsewhere.path(), &["push", "--quiet", "origin", "main"]);
}

/// Long polls `operation` until it's no longer running, and gives how it
/// finished.
fn wait_for_remote(started: &Value) -> Value {
    let operation = &started["operation"];
    let mut seen = Value::Null;
    for _ in 0..1000 {
        let report = value(call(
            "remoteProgress",
            json!({ "operation": operation, "seen": seen }),
        ));
        seen = report["generation"].clone();
        if report["state"]["kind"] != "running" {
            return report["state"].clone();
        }
    }
    panic!("{started} didn't finish");
}

fn main_upstream(dir: &Path) -> Value {
    let branches = value(call("branches", json!({ "repository": dir })));
    branches["local"]
        .as_array()
        .expect("local branches")
        .iter()
        .find(|branch| branch["name"] == "main")
        .expect("main")["upstream"]
        .clone()
}

#[test]
fn fetches_pulls_and_pushes_with_the_upstream_s_counts_in_the_branches() {
    let (host, mine) = remote_and_clone();
    let repository = mine.path();
    assert_eq!(
        main_upstream(repository),
        json!({ "name": "origin/main", "remote": "origin", "ahead": 0, "behind": 0, "gone": false })
    );
    push_from_elsewhere(host.path(), "Elsewhere");

    let started = value(call("startFetch", json!({ "repository": repository })));
    assert_eq!(started["kind"], json!("fetch"));
    assert_eq!(wait_for_remote(&started), json!({ "kind": "fetched" }));
    assert_eq!(main_upstream(repository)["behind"], json!(1));

    let pulled = wait_for_remote(&value(call(
        "startPull",
        json!({ "repository": repository, "mode": "fastForwardOnly" }),
    )));
    assert_eq!(
        pulled,
        json!({ "kind": "pulled", "pulled": { "kind": "updated", "commits": 1 } })
    );

    fs::write(repository.join("mine.txt"), "mine").unwrap();
    commit(repository, "Mine");
    assert_eq!(main_upstream(repository)["ahead"], json!(1));
    let pushed = wait_for_remote(&value(call(
        "startPush",
        json!({ "repository": repository }),
    )));
    assert_eq!(
        pushed,
        json!({ "kind": "pushed", "pushed": { "kind": "updated", "commits": 1 } })
    );
    assert_eq!(
        main_upstream(repository),
        json!({ "name": "origin/main", "remote": "origin", "ahead": 0, "behind": 0, "gone": false })
    );
    assert_eq!(
        value(call("remoteOperation", json!({ "repository": repository }))),
        Value::Null
    );
}

#[test]
fn a_push_the_remote_refuses_says_to_pull_first() {
    let (host, mine) = remote_and_clone();
    push_from_elsewhere(host.path(), "Elsewhere");
    fs::write(mine.path().join("mine.txt"), "mine").unwrap();
    commit(mine.path(), "Mine");

    let pushed = wait_for_remote(&value(call(
        "startPush",
        json!({ "repository": mine.path() }),
    )));

    assert_eq!(
        pushed,
        json!({ "kind": "failed", "error": { "kind": "rejected", "upstream": "origin/main" } })
    );
}

#[test]
fn a_rebasing_pull_that_stops_says_which_commit_it_is_on_and_can_be_aborted() {
    let (host, mine) = remote_and_clone();
    let repository = mine.path();
    push_from_elsewhere(host.path(), "Elsewhere");
    fs::write(repository.join("elsewhere.txt"), "Mine").unwrap();
    let head = commit(repository, "Mine");

    let pulled = wait_for_remote(&value(call(
        "startPull",
        json!({ "repository": repository, "mode": "rebase" }),
    )));
    assert_eq!(pulled["pulled"]["kind"], json!("stopped"), "{pulled}");
    assert_eq!(pulled["pulled"]["operation"], json!("rebase"));
    assert_eq!(pulled["pulled"]["conflicts"], json!(["elsewhere.txt"]));

    let rebase = value(call(
        "rebaseInProgress",
        json!({ "repository": repository }),
    ));
    assert_eq!(rebase["branch"], json!("main"));
    assert_eq!(rebase["step"], json!(1));
    assert_eq!(rebase["steps"], json!(1));
    assert_eq!(rebase["conflicts"], json!(["elsewhere.txt"]));
    assert_eq!(rebase["onto"]["summary"], json!("Elsewhere"));
    assert!(
        rebase["onto"]["labels"]
            .as_array()
            .unwrap()
            .contains(&json!({ "kind": "remoteBranch", "name": "origin/main" })),
        "{rebase}"
    );
    assert_eq!(
        wait_for_remote(&value(call(
            "startPull",
            json!({ "repository": repository })
        ))),
        json!({ "kind": "failed", "error": { "kind": "operationInProgress" } })
    );

    assert_eq!(
        value(call("abortRebase", json!({ "repository": repository }))),
        Value::Null
    );
    assert_eq!(
        value(call(
            "rebaseInProgress",
            json!({ "repository": repository })
        )),
        Value::Null
    );
    assert_eq!(git_output(repository, &["rev-parse", "HEAD"]), head);
    assert_eq!(
        error(call("abortRebase", json!({ "repository": repository }))),
        json!({ "kind": "notRebasing" })
    );
}

#[test]
fn a_rebasing_pull_that_stops_is_continued_on_its_conflicts_page() {
    let (host, mine) = remote_and_clone();
    let repository = mine.path();
    push_from_elsewhere(host.path(), "Elsewhere");
    fs::write(repository.join("elsewhere.txt"), "Mine").unwrap();
    commit(repository, "Mine");
    wait_for_remote(&value(call(
        "startPull",
        json!({ "repository": repository, "mode": "rebase" }),
    )));
    let request = json!({ "repository": repository });

    let operation = value(call("operationInProgress", request.clone()));
    assert_eq!(operation["kind"], "rebase", "{operation}");
    assert_eq!(operation["branch"], "main");
    assert_eq!(operation["step"], 1);
    assert_eq!(operation["steps"], 1);
    assert_eq!(operation["onto"]["summary"], "Elsewhere");
    assert_eq!(operation["conflicts"], json!(["elsewhere.txt"]));

    fs::write(repository.join("elsewhere.txt"), "Both").unwrap();
    value(call(
        "markResolved",
        json!({ "repository": repository, "paths": ["elsewhere.txt"] }),
    ));
    assert_eq!(
        value(call("continueOperation", request.clone())),
        Value::Null
    );

    assert_eq!(value(call("operationInProgress", request)), Value::Null);
    assert_eq!(
        git_output(repository, &["log", "-1", "--format=%s"]),
        "Mine"
    );
    assert_eq!(
        git_output(repository, &["log", "-1", "--format=%s", "HEAD~1"]),
        "Elsewhere"
    );
}

#[test]
fn one_remote_operation_runs_at_a_time_and_a_cancelled_one_says_so() {
    let (_host, mine) = remote_and_clone();
    let repository = mine.path();
    git_output(
        repository,
        &["remote", "set-url", "origin", &stalled::stalled_remote()],
    );

    let started = value(call("startFetch", json!({ "repository": repository })));
    assert_eq!(
        value(call("remoteOperation", json!({ "repository": repository }))),
        started
    );
    assert_eq!(
        error(call("startPush", json!({ "repository": repository }))),
        json!({ "kind": "alreadyRunning", "operation": started["operation"], "running": "fetch" })
    );
    assert_eq!(
        value(call(
            "cancelRemote",
            json!({ "operation": started["operation"] })
        )),
        Value::Null
    );

    assert_eq!(wait_for_remote(&started), json!({ "kind": "cancelled" }));
    assert_eq!(
        value(call("remoteOperation", json!({ "repository": repository }))),
        Value::Null
    );
    assert_eq!(
        error(call("remoteProgress", json!({ "operation": 0 }))),
        json!({ "kind": "operationNotFound", "operation": 0 })
    );
}

/// The remotes as `branches` lists them, each as its name, its URL and
/// whether the config has it.
fn remotes(dir: &Path) -> Vec<(String, Value, bool)> {
    value(call("branches", json!({ "repository": dir })))["remotes"]
        .as_array()
        .expect("remotes")
        .iter()
        .map(|remote| {
            (
                remote["name"].as_str().expect("a name").to_owned(),
                remote["url"].clone(),
                remote["configured"] == json!(true),
            )
        })
        .collect()
}

fn upstream_of(dir: &Path, branch: &str) -> Value {
    let branches = value(call("branches", json!({ "repository": dir })));
    branches["local"]
        .as_array()
        .expect("local branches")
        .iter()
        .find(|local| local["name"] == branch)
        .expect("the branch")["upstream"]
        .clone()
}

#[test]
fn adds_renames_changes_the_url_of_and_removes_a_remote() {
    let (_host, mine) = remote_and_clone();
    let repository = mine.path();
    let origin = git_output(repository, &["remote", "get-url", "origin"]);

    assert_eq!(
        value(call(
            "addRemote",
            json!({ "repository": repository, "name": "backup", "url": " https://example.com/a.git " })
        )),
        Value::Null
    );
    // Listed before anything is fetched from it.
    assert_eq!(
        remotes(repository),
        [
            ("backup".into(), json!("https://example.com/a.git"), true),
            ("origin".into(), json!(origin.trim()), true),
        ]
    );

    assert_eq!(
        value(call(
            "setRemoteUrl",
            json!({ "repository": repository, "name": "backup", "url": "https://example.com/b.git" })
        )),
        Value::Null
    );
    assert_eq!(remotes(repository)[0].1, json!("https://example.com/b.git"));

    assert_eq!(
        value(call(
            "renameRemote",
            json!({ "repository": repository, "from": "origin", "to": "team" })
        )),
        Value::Null
    );
    let listed = value(call("branches", json!({ "repository": repository })));
    assert_eq!(listed["remotes"][1]["name"], json!("team"));
    assert_eq!(
        listed["remotes"][1]["branches"][0]["name"],
        json!("team/main")
    );
    assert_eq!(upstream_of(repository, "main")["name"], json!("team/main"));
    assert_eq!(upstream_of(repository, "main")["remote"], json!("team"));

    assert_eq!(
        value(call(
            "removeRemote",
            json!({ "repository": repository, "name": "team" })
        )),
        Value::Null
    );
    assert_eq!(
        remotes(repository),
        [("backup".into(), json!("https://example.com/b.git"), true)]
    );
    assert_eq!(upstream_of(repository, "main"), Value::Null);
    assert_eq!(local_branches(repository), [branch("main", true)]);
}

#[test]
fn a_remote_s_urls_are_listed_with_their_credentials_hidden() {
    let (_host, mine) = remote_and_clone();
    let repository = mine.path();
    let url = "https://me:ghp_notARealToken@github.com/adrianeyre/lanewise.git";
    assert_eq!(
        value(call(
            "addRemote",
            json!({ "repository": repository, "name": "backup", "url": url })
        )),
        Value::Null
    );
    git_output(
        repository,
        &[
            "remote",
            "set-url",
            "--push",
            "backup",
            "https://ghp_notARealToken@github.com/adrianeyre/lanewise.git",
        ],
    );

    let listed = value(call("branches", json!({ "repository": repository })));
    assert_eq!(
        listed["remotes"][0]["url"],
        json!("https://***@github.com/adrianeyre/lanewise.git")
    );
    assert_eq!(
        listed["remotes"][0]["pushUrl"],
        json!("https://***@github.com/adrianeyre/lanewise.git")
    );
    assert!(!listed.to_string().contains("ghp_notARealToken"));
    // Git's config keeps them, for Git to sign in with.
    assert_eq!(
        git_output(repository, &["remote", "get-url", "backup"]).trim(),
        url
    );
}

#[test]
fn a_remote_change_git_does_not_allow_fails_saying_why() {
    let (_host, mine) = remote_and_clone();
    let repository = mine.path();

    assert_eq!(
        error(call(
            "addRemote",
            json!({ "repository": repository, "name": "two..dots", "url": "https://example.com/a.git" })
        )),
        json!({ "kind": "invalidName", "name": "two..dots" })
    );
    assert_eq!(
        error(call(
            "addRemote",
            json!({ "repository": repository, "name": "origin", "url": "https://example.com/a.git" })
        )),
        json!({ "kind": "alreadyExists", "name": "origin" })
    );
    assert_eq!(
        error(call(
            "setRemoteUrl",
            json!({ "repository": repository, "name": "origin", "url": "  " })
        )),
        json!({ "kind": "emptyUrl" })
    );
    for (name, request) in [
        (
            "renameRemote",
            json!({ "repository": repository, "from": "gone", "to": "team" }),
        ),
        (
            "setRemoteUrl",
            json!({ "repository": repository, "name": "gone", "url": "https://example.com/a.git" }),
        ),
        (
            "removeRemote",
            json!({ "repository": repository, "name": "gone" }),
        ),
    ] {
        assert_eq!(
            error(call(name, request)),
            json!({ "kind": "remoteNotFound", "name": "gone" }),
            "{name}"
        );
    }
    assert_eq!(remotes(repository).len(), 1);
}

#[test]
fn sets_and_changes_a_branch_s_upstream() {
    let (_host, mine) = remote_and_clone();
    let repository = mine.path();
    git_output(repository, &["branch", "--no-track", "feature"]);
    assert_eq!(upstream_of(repository, "feature"), Value::Null);

    assert_eq!(
        value(call(
            "setUpstream",
            json!({ "repository": repository, "branch": "feature", "upstream": "origin/main" })
        )),
        Value::Null
    );
    assert_eq!(
        upstream_of(repository, "feature")["name"],
        json!("origin/main")
    );

    assert_eq!(
        error(call(
            "setUpstream",
            json!({ "repository": repository, "branch": "gone", "upstream": "origin/main" })
        )),
        json!({ "kind": "branchNotFound", "name": "gone" })
    );
    assert_eq!(
        error(call(
            "setUpstream",
            json!({ "repository": repository, "branch": "feature", "upstream": "origin/gone" })
        )),
        json!({ "kind": "upstreamNotFound", "name": "origin/gone" })
    );
}

#[test]
fn pushing_a_branch_with_no_upstream_can_set_one() {
    let (host, mine) = remote_and_clone();
    let repository = mine.path();
    git_output(repository, &["switch", "--quiet", "-c", "feature"]);
    fs::write(repository.join("feature.txt"), "feature").unwrap();
    commit(repository, "Feature");

    assert_eq!(
        wait_for_remote(&value(call(
            "startPush",
            json!({ "repository": repository })
        ))),
        json!({ "kind": "failed", "error": { "kind": "noUpstream", "branch": "feature" } })
    );
    assert_eq!(
        wait_for_remote(&value(call(
            "startPush",
            json!({ "repository": repository, "setUpstream": { "remote": "gone", "branch": "feature" } })
        ))),
        json!({ "kind": "failed", "error": { "kind": "remoteNotFound", "remote": "gone" } })
    );

    let pushed = wait_for_remote(&value(call(
        "startPush",
        json!({ "repository": repository, "setUpstream": { "remote": "origin", "branch": "feature" } }),
    )));
    assert_eq!(
        pushed,
        json!({ "kind": "pushed", "pushed": { "kind": "updated", "commits": 1 } })
    );
    assert_eq!(
        upstream_of(repository, "feature"),
        json!({ "name": "origin/feature", "remote": "origin", "ahead": 0, "behind": 0, "gone": false })
    );
    let bare = host.path().join("lanewise.git");
    assert_eq!(
        git_output(&bare, &["rev-parse", "feature"]),
        git_output(repository, &["rev-parse", "feature"])
    );
}

/// `main` with `a.txt` as "one" then "two", and `feature`, from the first,
/// changing `a.txt` to "three" and adding `b.txt`: `feature`'s first commit
/// conflicts with `main`, its second doesn't. Gives the repository and
/// `feature`'s two commits.
fn repository_to_pick_from() -> (TempDir, String, String) {
    let dir = repository_to_commit_in();
    fs::write(dir.path().join("a.txt"), "one\n").unwrap();
    commit(dir.path(), "One");
    git_output(dir.path(), &["switch", "--quiet", "-c", "feature"]);
    fs::write(dir.path().join("a.txt"), "three\n").unwrap();
    let conflicting = commit(dir.path(), "Three");
    fs::write(dir.path().join("b.txt"), "b\n").unwrap();
    let clean = commit(dir.path(), "Add b");
    git_output(dir.path(), &["switch", "--quiet", "main"]);
    fs::write(dir.path().join("a.txt"), "two\n").unwrap();
    commit(dir.path(), "Two");
    (dir, conflicting, clean)
}

#[test]
fn tags_are_made_lightweight_or_annotated_and_deleted() {
    let (dir, ids) = repository_with_commits();
    // An annotated tag has a tagger, as Lanewise's own `git` makes it.
    for (key, value) in [
        ("user.name", "Lanewise Tests"),
        ("user.email", "tests@lanewise.invalid"),
        ("tag.gpgsign", "false"),
    ] {
        git_output(dir.path(), &["config", key, value]);
    }
    let tag = |name: &str, message: Value| {
        call(
            "createTag",
            json!({ "repository": dir.path(), "name": name, "commit": ids[1], "message": message }),
        )
    };

    assert_eq!(value(tag("v1", Value::Null)), Value::Null);
    assert_eq!(git_output(dir.path(), &["cat-file", "-t", "v1"]), "commit");
    assert_eq!(value(tag("v2", json!("The second"))), Value::Null);
    assert_eq!(git_output(dir.path(), &["cat-file", "-t", "v2"]), "tag");
    assert_eq!(
        git_output(
            dir.path(),
            &["tag", "--list", "--format=%(contents:subject)", "v2"]
        ),
        "The second"
    );
    assert_eq!(
        git_output(dir.path(), &["rev-parse", "v2^{commit}"]),
        ids[1]
    );

    assert_eq!(
        error(tag("v1", Value::Null)),
        json!({ "kind": "tagExists", "name": "v1" })
    );
    assert_eq!(
        error(tag("bad name", Value::Null)),
        json!({ "kind": "invalidTagName", "name": "bad name" })
    );
    assert_eq!(
        error(call(
            "createTag",
            json!({ "repository": dir.path(), "name": "v3", "commit": "0".repeat(40) })
        )),
        json!({ "kind": "commitNotFound", "commit": "0".repeat(40) })
    );

    assert_eq!(
        value(call(
            "deleteTag",
            json!({ "repository": dir.path(), "name": "v1" })
        )),
        Value::Null
    );
    assert_eq!(git_output(dir.path(), &["tag", "--list"]), "v2");
    assert_eq!(
        error(call(
            "deleteTag",
            json!({ "repository": dir.path(), "name": "v1" })
        )),
        json!({ "kind": "tagNotFound", "name": "v1" })
    );
}

#[test]
fn a_tag_is_renamed_at_the_same_commit_keeping_its_message() {
    let (dir, ids) = repository_with_commits();
    let rename = |from: &str, to: &str| {
        call(
            "renameTag",
            json!({ "repository": dir.path(), "from": from, "to": to }),
        )
    };
    git_output(dir.path(), &["tag", "light", &ids[1]]);
    git_output(
        dir.path(),
        &["tag", "-a", "-m", "The notes", "annotated", &ids[2]],
    );

    assert_eq!(value(rename("light", "v1")), Value::Null);
    assert_eq!(value(rename("annotated", "v2")), Value::Null);

    assert_eq!(git_output(dir.path(), &["tag", "--list"]), "v1\nv2");
    assert_eq!(git_output(dir.path(), &["rev-parse", "v1"]), ids[1]);
    assert_eq!(git_output(dir.path(), &["cat-file", "-t", "v2"]), "tag");
    assert_eq!(
        git_output(dir.path(), &["rev-parse", "v2^{commit}"]),
        ids[2]
    );
    assert_eq!(
        git_output(
            dir.path(),
            &["tag", "--list", "--format=%(tag) %(contents:subject)", "v2"]
        ),
        "v2 The notes",
        "the tag object names itself by its new name"
    );

    assert_eq!(
        error(rename("gone", "v3")),
        json!({ "kind": "tagNotFound", "name": "gone" })
    );
    assert_eq!(
        error(rename("v1", "v2")),
        json!({ "kind": "tagExists", "name": "v2" })
    );
    assert_eq!(
        error(rename("v1", "bad name")),
        json!({ "kind": "invalidTagName", "name": "bad name" })
    );
}

#[test]
fn rewording_a_commit_makes_it_and_the_commits_after_it_again_on_every_branch_with_it() {
    let (dir, ids) = repository_with_commits();
    git_output(dir.path(), &["branch", "older", &ids[3]]);
    git_output(dir.path(), &["branch", "before", &ids[0]]);
    git_output(dir.path(), &["tag", "v1", &ids[4]]);
    let tree = git_output(dir.path(), &["rev-parse", "HEAD^{tree}"]);
    let author = git_output(dir.path(), &["log", "-1", "--format=%an %ae %ad", &ids[1]]);

    let reworded = value(call(
        "rewordCommit",
        json!({
            "repository": dir.path(),
            "commit": ids[1],
            "message": "Second, reworded\n\nWith a description.",
        }),
    ));

    assert_eq!(reworded["branches"], json!(["main", "older"]));
    assert_eq!(reworded["detached"], json!(false));
    let new = reworded["commit"].as_str().expect("an ID").to_owned();
    assert_ne!(new, ids[1]);
    assert_eq!(
        git_output(dir.path(), &["log", "-1", "--format=%B", &new]),
        "Second, reworded\n\nWith a description."
    );
    assert_eq!(
        git_output(dir.path(), &["log", "-1", "--format=%an %ae %ad", &new]),
        author
    );
    assert_eq!(
        git_output(dir.path(), &["log", "--format=%s", "main"]),
        "Fifth\nFourth\nThird\nSecond, reworded\nFirst"
    );
    assert_eq!(git_output(dir.path(), &["rev-parse", "main^{tree}"]), tree);
    assert_eq!(git_output(dir.path(), &["rev-parse", "main~3"]), new);
    assert_eq!(git_output(dir.path(), &["rev-parse", "older~2"]), new);
    assert_eq!(git_output(dir.path(), &["rev-parse", "main~4"]), ids[0]);
    assert_eq!(git_output(dir.path(), &["rev-parse", "before"]), ids[0]);
    assert_eq!(
        git_output(dir.path(), &["rev-parse", "v1"]),
        ids[4],
        "tags stay where they were"
    );
    assert_eq!(git_output(dir.path(), &["status", "--porcelain"]), "");

    assert_eq!(
        error(call(
            "rewordCommit",
            json!({ "repository": dir.path(), "commit": new, "message": "  " }),
        )),
        json!({ "kind": "emptyMessage" })
    );
}

#[test]
fn rewording_a_commit_before_a_merge_keeps_the_merge_as_it_was() {
    let (dir, ids) = repository_with_commits();
    git_output(
        dir.path(),
        &["switch", "--quiet", "--create", "side", &ids[2]],
    );
    fs::write(dir.path().join("side.txt"), "side").expect("the file is written");
    let side = commit(dir.path(), "Side");
    git_output(dir.path(), &["switch", "--quiet", "main"]);
    git_output(
        dir.path(),
        &["merge", "--quiet", "--no-ff", "-m", "Merge side", "side"],
    );
    let tree = git_output(dir.path(), &["rev-parse", "HEAD^{tree}"]);

    value(call(
        "rewordCommit",
        json!({ "repository": dir.path(), "commit": ids[1], "message": "Second, reworded" }),
    ));

    assert_eq!(git_output(dir.path(), &["rev-parse", "main^{tree}"]), tree);
    assert_eq!(
        git_output(dir.path(), &["log", "-1", "--format=%s", "main"]),
        "Merge side"
    );
    let parents = git_output(dir.path(), &["log", "-1", "--format=%P", "main"]);
    assert_eq!(parents.split(' ').count(), 2, "still a merge");
    assert_eq!(
        git_output(dir.path(), &["log", "-1", "--format=%s", "side~1"]),
        "Third"
    );
    assert_eq!(
        git_output(dir.path(), &["log", "-1", "--format=%s", "side~2"]),
        "Second, reworded",
        "the branch merged has the commit too, so it moves with it"
    );
    assert_ne!(git_output(dir.path(), &["rev-parse", "side"]), side);
}

#[test]
fn rewording_a_commit_no_local_branch_has_fails() {
    let (dir, ids) = repository_with_commits();
    git_output(
        dir.path(),
        &["update-ref", "refs/remotes/origin/side", &ids[4]],
    );
    git_output(dir.path(), &["reset", "--hard", &ids[2]]);

    assert_eq!(
        error(call(
            "rewordCommit",
            json!({ "repository": dir.path(), "commit": ids[4], "message": "Mine" }),
        )),
        json!({ "kind": "notOnLocalBranch" })
    );
}

#[test]
fn rewording_a_commit_on_a_detached_head_moves_head() {
    let (dir, ids) = repository_with_commits();
    git_output(dir.path(), &["switch", "--detach", &ids[2]]);
    git_output(dir.path(), &["branch", "--force", "main", &ids[0]]);

    let reworded = value(call(
        "rewordCommit",
        json!({ "repository": dir.path(), "commit": ids[2], "message": "Third, reworded" }),
    ));

    assert_eq!(reworded["branches"], json!([]));
    assert_eq!(reworded["detached"], json!(true));
    assert_eq!(
        git_output(dir.path(), &["log", "-1", "--format=%s"]),
        "Third, reworded"
    );
    assert_eq!(git_output(dir.path(), &["rev-parse", "HEAD~1"]), ids[1]);
}

#[test]
fn a_commit_is_checked_out_with_head_detached() {
    let (dir, ids) = repository_with_commits();

    assert_eq!(
        value(call(
            "checkOut",
            json!({ "repository": dir.path(), "branch": { "kind": "commit", "commit": ids[2] } })
        )),
        json!({ "branch": null, "stash": null })
    );
    assert_eq!(git_output(dir.path(), &["rev-parse", "HEAD"]), ids[2]);
    assert_eq!(
        git_output(dir.path(), &["branch", "--show-current"]),
        "",
        "HEAD is detached"
    );
}

#[test]
fn a_clean_cherry_pick_commits_and_one_that_conflicts_is_an_operation_to_continue() {
    let (dir, conflicting, clean) = repository_to_pick_from();
    let repository = json!({ "repository": dir.path() });

    let picked = value(call(
        "cherryPick",
        json!({ "repository": dir.path(), "commit": clean }),
    ));
    assert_eq!(picked["kind"], "committed");
    assert_eq!(
        picked["commit"],
        git_output(dir.path(), &["rev-parse", "HEAD"])
    );
    assert_eq!(
        git_output(dir.path(), &["log", "-1", "--format=%s"]),
        "Add b"
    );

    assert_eq!(
        value(call(
            "cherryPick",
            json!({ "repository": dir.path(), "commit": conflicting })
        )),
        json!({ "kind": "stopped", "conflicts": ["a.txt"] })
    );
    let operation = value(call("operationInProgress", repository.clone()));
    assert_eq!(operation["kind"], "cherryPick");
    assert_eq!(operation["into"], "main");
    assert_eq!(operation["commit"]["id"], conflicting);
    assert_eq!(operation["conflicts"], json!(["a.txt"]));

    // Nothing else starts while it's in progress.
    assert_eq!(
        error(call(
            "revertCommit",
            json!({ "repository": dir.path(), "commit": clean })
        )),
        json!({ "kind": "operationInProgress" })
    );

    fs::write(dir.path().join("a.txt"), "two and three\n").unwrap();
    value(call(
        "markResolved",
        json!({ "repository": dir.path(), "paths": ["a.txt"] }),
    ));
    assert_eq!(
        value(call("continueOperation", repository.clone())),
        Value::Null
    );
    assert_eq!(
        git_output(dir.path(), &["log", "-1", "--format=%s"]),
        "Three"
    );
    assert_eq!(value(call("operationInProgress", repository)), Value::Null);
}

#[test]
fn a_cherry_pick_that_conflicts_can_be_aborted_or_skipped() {
    let (dir, conflicting, _) = repository_to_pick_from();
    let repository = json!({ "repository": dir.path() });
    let before = git_output(dir.path(), &["rev-parse", "HEAD"]);
    let pick = || {
        value(call(
            "cherryPick",
            json!({ "repository": dir.path(), "commit": conflicting }),
        ))
    };

    assert_eq!(pick()["kind"], "stopped");
    assert_eq!(
        value(call("abortOperation", repository.clone())),
        Value::Null
    );
    assert_eq!(git_output(dir.path(), &["rev-parse", "HEAD"]), before);
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "two\n"
    );

    assert_eq!(pick()["kind"], "stopped");
    assert_eq!(value(call("skipCommit", repository.clone())), Value::Null);
    assert_eq!(git_output(dir.path(), &["rev-parse", "HEAD"]), before);
    assert_eq!(value(call("operationInProgress", repository)), Value::Null);
}

#[test]
fn a_revert_commits_the_undoing_and_one_that_conflicts_is_an_operation() {
    let (dir, _, _) = repository_to_pick_from();
    let repository = json!({ "repository": dir.path() });
    fs::write(dir.path().join("c.txt"), "c\n").unwrap();
    let added = commit(dir.path(), "Add c");

    let reverted = value(call(
        "revertCommit",
        json!({ "repository": dir.path(), "commit": added }),
    ));
    assert_eq!(reverted["kind"], "committed");
    assert!(!dir.path().join("c.txt").exists());
    assert_eq!(
        git_output(dir.path(), &["log", "-1", "--format=%s"]),
        "Revert \"Add c\""
    );

    // Reverting "Two" once "a.txt" has changed again conflicts.
    let two = git_output(dir.path(), &["rev-parse", "HEAD~2"]);
    fs::write(dir.path().join("a.txt"), "four\n").unwrap();
    commit(dir.path(), "Four");
    assert_eq!(
        value(call(
            "revertCommit",
            json!({ "repository": dir.path(), "commit": two })
        )),
        json!({ "kind": "stopped", "conflicts": ["a.txt"] })
    );
    let operation = value(call("operationInProgress", repository.clone()));
    assert_eq!(operation["kind"], "revert");
    assert_eq!(operation["commit"]["id"], two);
    assert_eq!(value(call("abortOperation", repository)), Value::Null);
}

#[test]
fn a_reset_is_previewed_naming_the_commits_it_would_leave_and_only_made_if_head_has_not_moved() {
    let (dir, ids) = repository_with_commits();
    // A branch keeps the fourth commit, so only the fifth would be left.
    git_output(dir.path(), &["branch", "keep", &ids[3]]);
    fs::write(dir.path().join("Fifth.txt"), "changed").unwrap();

    let preview = value(call(
        "previewReset",
        json!({ "repository": dir.path(), "commit": ids[2] }),
    ));
    assert_eq!(preview["branch"], "main");
    assert_eq!(preview["head"], ids[4]);
    assert_eq!(preview["count"], 1);
    assert_eq!(preview["lost"][0]["id"], ids[4]);
    assert_eq!(preview["uncommitted"], true);

    let reset = |mode: &str, head: &str| {
        call(
            "reset",
            json!({ "repository": dir.path(), "commit": ids[2], "mode": mode, "head": head }),
        )
    };
    assert_eq!(
        error(reset("hard", &ids[3])),
        json!({ "kind": "headMoved" })
    );
    assert_eq!(git_output(dir.path(), &["rev-parse", "HEAD"]), ids[4]);

    assert_eq!(value(reset("soft", &ids[4])), Value::Null);
    assert_eq!(git_output(dir.path(), &["rev-parse", "HEAD"]), ids[2]);
    // The changes since stay staged.
    assert!(git_output(dir.path(), &["diff", "--cached", "--name-only"]).contains("Fourth.txt"));

    assert_eq!(value(reset("hard", &ids[2])), Value::Null);
    assert_eq!(git_output(dir.path(), &["status", "--porcelain"]), "");
    assert!(!dir.path().join("Fifth.txt").exists());
}
