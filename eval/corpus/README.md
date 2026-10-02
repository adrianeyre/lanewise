# The conflict evaluation corpus

Made by `pnpm eval:corpus` (`app/scripts/eval/buildCorpus.ts`) from `eval/repositories.json`; don't edit it by hand. See `eval/README.md` and ADR 0027.

Each Conflict Hunk comes from a real merge in one of these open-source repositories, replayed with git version 2.47.3, and its ground truth is what the merge commit has in its place. Each file here keeps only enough of a conflicted file for the Suggestion request, and is the work of that repository's authors under its licence, which is kept beside it.

| Repository | Licence | Merges read back from | Merges replayed at most | Conflicted files | Conflict Hunks |
| --- | --- | --- | --- | --- | --- |
| [click](https://github.com/pallets/click) | [BSD-3-Clause](click.LICENSE) | [`06b2a6787411`](https://github.com/pallets/click/commit/06b2a678741131fd577ce170e23e5ca0aeba0309) | 300 | 20 | 20 |
| [express](https://github.com/expressjs/express) | [MIT](express.LICENSE) | [`7ef98448f8b3`](https://github.com/expressjs/express/commit/7ef98448f8b38099ab1ded55e458538ad47a51e7) | 300 | 14 | 20 |
| [flask](https://github.com/pallets/flask) | [BSD-3-Clause](flask.LICENSE) | [`d73fa1cdcbd8`](https://github.com/pallets/flask/commit/d73fa1cdcbd8b1465c151db8924ba58b1dd14e35) | 300 | 18 | 20 |
| [sphinx](https://github.com/sphinx-doc/sphinx) | [BSD-2-Clause](sphinx.LICENSE) | [`b04a2101295a`](https://github.com/sphinx-doc/sphinx/commit/b04a2101295ac3fb725b16111eda0284b6da4cca) | 300 | 15 | 20 |
| [tokio](https://github.com/tokio-rs/tokio) | [MIT](tokio.LICENSE) | [`e133b6fec055`](https://github.com/tokio-rs/tokio/commit/e133b6fec055d5cab447c06f953d330ce34f1517) | 300 | 20 | 20 |
| [werkzeug](https://github.com/pallets/werkzeug) | [BSD-3-Clause](werkzeug.LICENSE) | [`f7e37f0bf510`](https://github.com/pallets/werkzeug/commit/f7e37f0bf510fa355fdac3e922cc2078916b021f) | 300 | 16 | 20 |

120 Conflict Hunks in all. How their merges resolved them: Ours: 56; Theirs: 26; Ours then Theirs: 18; Theirs then Ours: 0; Written anew: 20.
