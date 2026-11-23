// Unit tests for Bases Conditional Format. Run with: node tests/run.js
const Module = require("module");
const assert = require("assert");

const fake = {
  Plugin: class { async saveData() {} async loadData() { return {}; } },
  PluginSettingTab: class {},
  Setting: class {},
  Notice: class {},
  Modal: class {},
  SuggestModal: class {},
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === "obsidian" ? fake : origLoad.call(this, req, ...rest);
};

const P = require(require("path").join(__dirname, "..", "main.js"));
const I = P._internals;

async function main() {
  // --- numeric & date parsing
  assert.strictEqual(I.parseNumericValue("$1,234.56"), 1234.56);
  assert.strictEqual(I.parseNumericValue("€ 1.234,56"), 1234.56);
  assert.strictEqual(I.parseNumericValue("85%"), 85);
  assert.strictEqual(I.parseNumericValue("3.2×"), 3.2);
  assert.strictEqual(I.parseNumericValue("-$12.50"), -12.5);
  assert.strictEqual(I.parseNumericValue("2026-11-24"), null, "ISO dates must not parse as numbers");
  assert.strictEqual(I.parseNumericValue("abc"), null);

  const dt = I.parseDateValue("2026-11-24");
  assert.ok(dt instanceof Date && dt.getFullYear() === 2026 && dt.getMonth() === 10 && dt.getDate() === 24);
  assert.strictEqual(I.parseDateValue("2026-02-31"), null);
  console.log("parsing ok");

  // --- column matching
  assert.strictEqual(I.matchesColumn("ads_cpa", "note.ads_cpa"), true);
  assert.strictEqual(I.matchesColumn("status, state", "STATE"), true);
  assert.strictEqual(I.matchesColumn("*", "anything"), true);
  assert.strictEqual(I.matchesColumn("formula.cpa", "cpa"), true);
  assert.strictEqual(I.matchesColumn("status", "priority"), false);
  console.log("columns ok");

  // --- operators
  const now = new Date(2026, 10, 24);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "equals", value: "Done" }), "done"), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "not_equals", value: "Done" }), "todo"), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "contains", value: "prog" }), "In Progress"), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "not_contains", value: "prog" }), "Done"), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "starts_with", value: "p1" }), "P1 - Urgent"), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "regex", value: "^Q[1-4]-2026$" }), "Q4-2026"), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "regex", value: "[invalid(" }), "test"), false);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "gt", value: "20" }), "$25.50"), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "lte", value: "20" }), "$20.00"), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "between", value: "10", value2: "30" }), "22"), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "between", value: "10", value2: "30" }), "35"), false);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "is_empty" }), "   "), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "is_not_empty" }), "x"), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "date_before_today" }), "2026-11-23", now), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "date_before_today" }), "2026-11-24", now), false);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "date_is_today" }), "2026-11-24", now), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "date_within_days", value: "3" }), "2026-11-26", now), true);
  assert.strictEqual(I.evaluateRule(I.makeRule({ operator: "date_within_days", value: "3" }), "2026-12-01", now), false);
  console.log("operators ok");

  // --- bar percentage & resolveFormatting
  assert.strictEqual(I.computeBarPct("65%", 0, 100), 65);
  assert.strictEqual(I.computeBarPct("150", 0, 100), 100);
  assert.strictEqual(I.computeBarPct("-10", 0, 100), 0);

  const rules = [
    I.makeRule({ column: "ads_cpa", operator: "gt", value: "20", styleMode: "badge", color: "red", icon: "🔴", bold: true, stopOnMatch: true }),
    I.makeRule({ column: "ads_cpa", operator: "gt", value: "10", styleMode: "row", color: "yellow" }),
    I.makeRule({ column: "progress", operator: "always", styleMode: "bar", color: "green", barMin: 0, barMax: 100 }),
    I.makeRule({ column: "priority", operator: "equals", value: "high", styleMode: "row", color: "custom", customColor: "#ff0055" }),
  ];

  const f1 = I.resolveFormatting(rules, "note.ads_cpa", "$25.00", now);
  assert.ok(f1.cellClasses.includes("bcf-mode-badge"));
  assert.ok(f1.cellClasses.includes("bcf-color-red"));
  assert.ok(f1.cellClasses.includes("bcf-bold"));
  assert.strictEqual(f1.icon, "🔴");
  assert.strictEqual(f1.rowClasses.length, 0, "stopOnMatch must prevent second rule from firing");

  const f2 = I.resolveFormatting(rules, "progress", "75%", now);
  assert.ok(f2.cellClasses.includes("bcf-mode-bar"));
  assert.strictEqual(f2.cssProps["--bcf-bar-pct"], "75%");

  const f3 = I.resolveFormatting(rules, "priority", "High", now);
  assert.ok(f3.rowClasses.includes("bcf-row-matched"));
  assert.strictEqual(f3.rowCssProps["--bcf-custom-color"], "#ff0055");
  console.log("formatting ok");

  // --- presets & import validation
  assert.ok(I.RULE_PRESETS.length >= 5);
  const imported = I.validateImportedRules(JSON.stringify([{ name: "Test", column: "status", operator: "equals", value: "done", color: "green" }]));
  assert.strictEqual(imported.length, 1);
  assert.strictEqual(imported[0].enabled, true);
  assert.throws(() => I.validateImportedRules('{"not":"array"}'));
  console.log("presets & import ok");

  console.log("all tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
