# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.2] - 2026-11-24

### Fixed

- Pill badge CSS selectors now match nested Bases cell wrappers and flat cells cleanly, and prefix icons render inside the badge pill instead of outside it.
- Multiple matching rules on the same cell or row now cleanly override the previous colour class by rule order instead of conflicting via CSS order.
- Added delegated `input` and `change` listeners inside `.bases-view` so inline cell edits re-evaluate formatting immediately.
- Removed unused `.style.setProperty` fallback in favour of Obsidian's native `setCssProps`.

## [1.0.1] - 2026-11-24

### Changed

- Removed redundant "Obsidian" from `manifest.json` description for directory review guidelines.

## [1.0.0] - 2026-11-24

### Added

- Conditional formatting engine for Obsidian Bases tables and cards (and optional Markdown / Dataview tables)
- 5 style modes: Pill badge, Cell fill, Text colour, Row / Card highlight, and Inline progress bar
- 17 comparison operators covering text, numbers, currency, percentages, regex and dates
- Built-in rule presets (Ad CPA, Task status, Priority, Due dates, Progress bar), live rule preview and JSON import/export
- Desktop and mobile support

[1.0.2]: https://github.com/chi-li-peppers/obsidian-bases-conditional-format/releases/tag/1.0.2
[1.0.1]: https://github.com/chi-li-peppers/obsidian-bases-conditional-format/releases/tag/1.0.1
[1.0.0]: https://github.com/chi-li-peppers/obsidian-bases-conditional-format/releases/tag/1.0.0
