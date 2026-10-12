//! Web Mode's design (ADR 0055) says, before Web Mode is built, which of the
//! command API's commands cross its WebSocket. These hold that table to the
//! command API, so a new command has a row there before it has a caller.

use std::collections::BTreeMap;

use lanewise_commands::NAMES;

const DESIGN: &str = include_str!(
    "../../docs/architectural-decision-record/0055-web-mode-reached-only-from-its-own-page-with-a-fresh-access-token-and-never-handed-a-key.md"
);

/// Each command named in the first column of the design's table, with the
/// second column's word for whether it crosses, once for each time it's named.
fn placed() -> Vec<(String, String)> {
    let section = DESIGN
        .split("\n## 4. ")
        .nth(1)
        .expect("ADR 0055 has its §4")
        .split("\n## ")
        .next()
        .unwrap();
    let mut placed = Vec::new();
    for row in section.lines().filter(|line| line.starts_with("| `")) {
        let cells: Vec<&str> = row.split('|').map(str::trim).collect();
        let (commands, crosses) = (cells[1], cells[2]);
        for name in commands.split('`').skip(1).step_by(2) {
            placed.push((name.to_owned(), crosses.to_owned()));
        }
    }
    placed
}

#[test]
fn every_command_the_command_api_has_is_placed_once_in_web_modes_design() {
    let placed = placed();
    let mut times = BTreeMap::<&str, usize>::new();
    for (name, _) in &placed {
        *times.entry(name).or_default() += 1;
    }

    for name in NAMES {
        assert_eq!(
            times.get(name),
            Some(&1),
            "{name} needs one row in ADR 0055's §4"
        );
    }
    for name in times.keys() {
        assert!(
            NAMES.contains(name),
            "ADR 0055's §4 names {name}, which isn't a command"
        );
    }
}

#[test]
fn the_websocket_carries_every_command_but_the_one_that_hands_out_a_key() {
    let placed = placed();
    let words: Vec<&str> = placed.iter().map(|(_, crosses)| crosses.as_str()).collect();
    let kept_back: Vec<&str> = placed
        .iter()
        .filter(|(_, crosses)| crosses != "Crosses")
        .map(|(name, _)| name.as_str())
        .collect();

    assert!(
        words
            .iter()
            .all(|word| ["Crosses", "Doesn't cross"].contains(word)),
        "{words:?}"
    );
    assert_eq!(kept_back, ["modelProviderKey"]);
}
