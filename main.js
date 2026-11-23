"use strict";

const obsidian = require("obsidian");
const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  SuggestModal,
} = obsidian;

/* ------------------------------------------------------------------ */
/* Presets & Defaults                                                  */
/* ------------------------------------------------------------------ */

const COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "gray", "custom"];

const OPERATORS = [
  { id: "equals", label: "Equals (=)" },
  { id: "not_equals", label: "Not equals (≠)" },
  { id: "contains", label: "Contains" },
  { id: "not_contains", label: "Does not contain" },
  { id: "starts_with", label: "Starts with" },
  { id: "regex", label: "Matches regex" },
  { id: "gt", label: "Greater than (>)" },
  { id: "gte", label: "Greater or equal (≥)" },
  { id: "lt", label: "Less than (<)" },
  { id: "lte", label: "Less or equal (≤)" },
  { id: "between", label: "Between (min..max)" },
  { id: "is_empty", label: "Is empty" },
  { id: "is_not_empty", label: "Is not empty" },
  { id: "date_before_today", label: "Date is overdue (< today)" },
  { id: "date_is_today", label: "Date is today" },
  { id: "date_within_days", label: "Date within N days" },
  { id: "always", label: "Always (e.g. progress bar)" },
];

const STYLE_MODES = [
  { id: "badge", label: "Pill badge" },
  { id: "cell", label: "Cell fill" },
  { id: "text", label: "Text colour" },
  { id: "row", label: "Row / card highlight" },
  { id: "bar", label: "Inline progress bar" },
];

const RULE_PRESETS = [
  {
    id: "ad-cpa",
    label: "Ad CPA thresholds (ads_cpa ≤ 20 green, > 20 red)",
    rules: [
      { name: "CPA on target", column: "ads_cpa, cpa", operator: "lte", value: "20", styleMode: "badge", color: "green", icon: "🟢", bold: true },
      { name: "CPA over target", column: "ads_cpa, cpa", operator: "gt", value: "20", styleMode: "badge", color: "red", icon: "🔴", bold: true },
    ],
  },
  {
    id: "task-status",
    label: "Task status badges (Done, In Progress, Blocked, Todo)",
    rules: [
      { name: "Status: Done", column: "status", operator: "equals", value: "done", styleMode: "badge", color: "green", icon: "✅" },
      { name: "Status: In Progress", column: "status", operator: "contains", value: "progress", styleMode: "badge", color: "blue", icon: "🔵" },
      { name: "Status: Blocked", column: "status", operator: "equals", value: "blocked", styleMode: "badge", color: "red", icon: "⛔", bold: true },
      { name: "Status: Todo", column: "status", operator: "equals", value: "todo", styleMode: "badge", color: "gray" },
    ],
  },
  {
    id: "priority",
    label: "Priority highlights (High, Medium, Low)",
    rules: [
      { name: "Priority: High", column: "priority", operator: "equals", value: "high", styleMode: "badge", color: "red", icon: "🔥", bold: true },
      { name: "Priority: Medium", column: "priority", operator: "equals", value: "medium", styleMode: "badge", color: "orange" },
      { name: "Priority: Low", column: "priority", operator: "equals", value: "low", styleMode: "badge", color: "gray" },
    ],
  },
  {
    id: "overdue-dates",
    label: "Due dates (overdue red cell, today yellow badge)",
    rules: [
      { name: "Overdue", column: "due, due_date, deadline", operator: "date_before_today", value: "", styleMode: "cell", color: "red", icon: "⚠️", bold: true },
      { name: "Due today", column: "due, due_date, deadline", operator: "date_is_today", value: "", styleMode: "badge", color: "yellow", icon: "📅" },
    ],
  },
  {
    id: "progress-bar",
    label: "Progress bar (0–100% inline bar)",
    rules: [
      { name: "Progress bar", column: "progress, completion", operator: "always", value: "", styleMode: "bar", color: "green", barMin: 0, barMax: 100 },
    ],
  },
];

const DEFAULT_SETTINGS = {
  enabled: true,
  applyToMarkdownTables: false,
  rules: [],
};

const ALL_BCF_CLASSES = [
  "bcf-matched",
  "bcf-row-matched",
  "bcf-has-icon",
  "bcf-bold",
  "bcf-strike",
  "bcf-mode-badge",
  "bcf-mode-cell",
  "bcf-mode-text",
  "bcf-mode-row",
  "bcf-mode-bar",
  ...COLORS.map((c) => `bcf-color-${c}`),
];

/* ------------------------------------------------------------------ */
/* Pure Rule Engine                                                    */
/* ------------------------------------------------------------------ */

function makeRule(partial = {}) {
  return {
    id: partial.id || `rule-${Math.random().toString(36).slice(2, 9)}`,
    enabled: partial.enabled !== false,
    name: String(partial.name || "New rule"),
    column: String(partial.column || ""),
    operator: String(partial.operator || "equals"),
    value: String(partial.value ?? ""),
    value2: String(partial.value2 ?? ""),
    styleMode: String(partial.styleMode || "badge"),
    color: COLORS.includes(partial.color) ? partial.color : "blue",
    customColor: String(partial.customColor || ""),
    icon: String(partial.icon || ""),
    bold: !!partial.bold,
    strikethrough: !!partial.strikethrough,
    barMin: Number.isFinite(Number(partial.barMin)) ? Number(partial.barMin) : 0,
    barMax: Number.isFinite(Number(partial.barMax)) ? Number(partial.barMax) : 100,
    stopOnMatch: !!partial.stopOnMatch,
  };
}

/**
 * Parse a display cell string into a finite number (or null if non-numeric).
 * Handles currency symbols, commas, %, ×, and leading minus signs.
 */
function parseNumericValue(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Reject strings that look like ISO dates (2026-11-24).
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const neg = /^-|^[^\d]*-/.test(s);
  const cleaned = s.replace(/[^\d.,]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;

  let norm = cleaned;
  const hasDot = norm.includes(".");
  const hasComma = norm.includes(",");
  if (hasDot && hasComma) {
    norm = norm.lastIndexOf(",") > norm.lastIndexOf(".")
      ? norm.replace(/\./g, "").replace(",", ".")
      : norm.replace(/,/g, "");
  } else if (hasComma) {
    const commas = (norm.match(/,/g) || []).length;
    norm = commas > 1 || /^[1-9]\d{0,2},\d{3}$/.test(norm)
      ? norm.replace(/,/g, "")
      : norm.replace(",", ".");
  }
  const n = parseFloat(norm);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

function parseDateValue(raw) {
  const s = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function stripPropertyPrefix(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^(?:note|file|formula)\./, "");
}

function matchesColumn(ruleColumn, cellColumn) {
  const targets = String(ruleColumn || "")
    .split(",")
    .map((x) => stripPropertyPrefix(x))
    .filter(Boolean);
  if (!targets.length) return false;
  if (targets.includes("*")) return true;
  const actual = stripPropertyPrefix(cellColumn);
  if (!actual) return false;
  return targets.includes(actual);
}

function evaluateRule(rule, rawValue, nowDate) {
  if (!rule || rule.enabled === false) return false;
  const op = rule.operator;
  const text = String(rawValue ?? "").trim();
  const textLower = text.toLowerCase();
  const target = String(rule.value ?? "").trim();
  const targetLower = target.toLowerCase();

  if (op === "always") return text.length > 0;
  if (op === "is_empty") return text.length === 0;
  if (op === "is_not_empty") return text.length > 0;
  if (op === "equals") return textLower === targetLower;
  if (op === "not_equals") return textLower !== targetLower;
  if (op === "contains") return targetLower.length > 0 && textLower.includes(targetLower);
  if (op === "not_contains") return targetLower.length > 0 && !textLower.includes(targetLower);
  if (op === "starts_with") return targetLower.length > 0 && textLower.startsWith(targetLower);

  if (op === "regex") {
    if (!target || target.length > 200) return false;
    try {
      return new RegExp(target, "i").test(text);
    } catch (e) {
      return false;
    }
  }

  if (op === "gt" || op === "gte" || op === "lt" || op === "lte" || op === "between") {
    const n = parseNumericValue(text);
    const t1 = parseNumericValue(target);
    if (n === null || t1 === null) return false;
    if (op === "gt") return n > t1;
    if (op === "gte") return n >= t1;
    if (op === "lt") return n < t1;
    if (op === "lte") return n <= t1;
    const t2 = parseNumericValue(rule.value2);
    if (t2 === null) return false;
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    return n >= lo && n <= hi;
  }

  if (op === "date_before_today" || op === "date_is_today" || op === "date_within_days") {
    const dt = parseDateValue(text);
    if (!dt) return false;
    const ref = nowDate || new Date();
    const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    const diffDays = Math.round((dt.getTime() - today.getTime()) / 86400000);
    if (op === "date_before_today") return diffDays < 0;
    if (op === "date_is_today") return diffDays === 0;
    const windowDays = parseNumericValue(target);
    if (windowDays === null) return false;
    return diffDays >= 0 && diffDays <= windowDays;
  }

  return false;
}

function computeBarPct(rawValue, min, max) {
  const n = parseNumericValue(rawValue);
  if (n === null) return 0;
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) && max !== lo ? max : lo + 100;
  const pct = ((n - lo) / (hi - lo)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

/**
 * Evaluate all rules against a (column, rawValue) pair and return computed cell/row styling instructions.
 */
function resolveFormatting(rules, column, rawValue, nowDate) {
  const cellClasses = new Set();
  const rowClasses = new Set();
  const cssProps = {};
  const rowCssProps = {};
  let icon = "";

  for (const rule of rules || []) {
    if (!rule.enabled) continue;
    if (!matchesColumn(rule.column, column)) continue;
    if (!evaluateRule(rule, rawValue, nowDate)) continue;

    const colorClass = `bcf-color-${COLORS.includes(rule.color) ? rule.color : "blue"}`;

    if (rule.styleMode === "row") {
      rowClasses.add("bcf-row-matched");
      rowClasses.add(colorClass);
      if (rule.color === "custom" && rule.customColor) {
        rowCssProps["--bcf-custom-color"] = rule.customColor;
      }
    } else {
      cellClasses.add("bcf-matched");
      cellClasses.add(`bcf-mode-${rule.styleMode}`);
      cellClasses.add(colorClass);
      if (rule.color === "custom" && rule.customColor) {
        cssProps["--bcf-custom-color"] = rule.customColor;
      }
      if (rule.styleMode === "bar") {
        cssProps["--bcf-bar-pct"] = `${computeBarPct(rawValue, rule.barMin, rule.barMax)}%`;
      }
    }

    if (rule.icon) {
      icon = rule.icon;
      cellClasses.add("bcf-has-icon");
    }
    if (rule.bold) cellClasses.add("bcf-bold");
    if (rule.strikethrough) cellClasses.add("bcf-strike");

    if (rule.stopOnMatch) break;
  }

  return {
    cellClasses: [...cellClasses],
    rowClasses: [...rowClasses],
    cssProps,
    rowCssProps,
    icon,
  };
}

function validateImportedRules(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error("Rules JSON must be an array of rule objects.");
  return parsed.map((r) => makeRule(r));
}

/* ------------------------------------------------------------------ */
/* DOM Application Helpers                                             */
/* ------------------------------------------------------------------ */

function applyCssProps(el, props) {
  if (!el || !props) return;
  if (typeof el.setCssProps === "function") {
    el.setCssProps(props);
  } else if (el.style) {
    for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v);
  }
}

function clearElementFormatting(el) {
  if (!el || !el.classList) return;
  for (const cls of ALL_BCF_CLASSES) el.classList.remove(cls);
  el.removeAttribute("data-bcf-icon");
  applyCssProps(el, { "--bcf-bar-pct": "", "--bcf-custom-color": "" });
}

function readCellText(cellEl) {
  if (!cellEl) return "";
  const input = cellEl.querySelector("input[type='text'], input[type='number'], input[type='date']");
  if (input && typeof input.value === "string") return input.value.trim();
  const checkbox = cellEl.querySelector("input[type='checkbox']");
  if (checkbox) return checkbox.checked ? "true" : "false";
  return (cellEl.textContent || "").trim();
}

function applyFormattingToCell(cellEl, rowEl, column, rules) {
  clearElementFormatting(cellEl);
  if (!rules.length) return;
  const text = readCellText(cellEl);
  const fmt = resolveFormatting(rules, column, text);

  if (fmt.cellClasses.length) {
    for (const c of fmt.cellClasses) cellEl.classList.add(c);
    applyCssProps(cellEl, fmt.cssProps);
    if (fmt.icon) cellEl.setAttribute("data-bcf-icon", fmt.icon);
  }
  if (rowEl && fmt.rowClasses.length) {
    for (const c of fmt.rowClasses) rowEl.classList.add(c);
    applyCssProps(rowEl, fmt.rowCssProps);
  }
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

class BasesConditionalFormatPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._scanTimer = null;
    this._observer = null;

    this.addCommand({
      id: "toggle-formatting",
      name: "Toggle conditional formatting",
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
        new Notice(`Bases Conditional Format: ${this.settings.enabled ? "enabled" : "disabled"}`);
      },
    });

    this.addCommand({
      id: "refresh-formatting",
      name: "Refresh formatting in current view",
      callback: () => {
        this.scanAll();
        new Notice("Bases Conditional Format: refreshed");
      },
    });

    this.addCommand({
      id: "add-preset",
      name: "Add rule from preset",
      callback: () => {
        new PresetModal(this.app, async (preset) => {
          for (const r of preset.rules) this.settings.rules.push(makeRule(r));
          await this.saveSettings();
          new Notice(`Bases Conditional Format: added "${preset.label}"`);
        }).open();
      },
    });

    this.addSettingTab(new BasesConditionalFormatSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.startObserver();
      this.scheduleScan();
      this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleScan()));
      this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleScan()));
    });
  }

  onunload() {
    if (this._scanTimer) {
      window.clearTimeout(this._scanTimer);
      this._scanTimer = null;
    }
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this.clearAll();
  }

  async loadSettings() {
    const loaded = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    this.settings.rules = Array.isArray(this.settings.rules)
      ? this.settings.rules.map((r) => makeRule(r))
      : [];
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.scheduleScan();
  }

  startObserver() {
    if (this._observer || typeof MutationObserver === "undefined") return;
    const root = document.body;
    if (!root) return;
    this._observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList" || m.type === "characterData") {
          const target = m.target instanceof Element ? m.target : m.target?.parentElement;
          if (target && (target.closest(".bases-view") || (this.settings.applyToMarkdownTables && target.closest("table")))) {
            this.scheduleScan();
            return;
          }
          for (const node of m.addedNodes || []) {
            if (node instanceof Element && (node.matches?.(".bases-view, .bases-tr, .bases-td, .bases-cards-item, table") || node.querySelector?.(".bases-view, .bases-tr, .bases-cards-item"))) {
              this.scheduleScan();
              return;
            }
          }
        }
      }
    });
    this._observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  scheduleScan() {
    if (this._scanTimer) window.clearTimeout(this._scanTimer);
    this._scanTimer = window.setTimeout(() => {
      this._scanTimer = null;
      this.scanAll();
    }, 80);
  }

  clearAll() {
    if (typeof document === "undefined") return;
    for (const el of document.querySelectorAll(".bcf-matched, .bcf-row-matched")) {
      clearElementFormatting(el);
    }
  }

  scanAll() {
    if (typeof document === "undefined") return;
    if (!this.settings.enabled || !this.settings.rules.some((r) => r.enabled)) {
      this.clearAll();
      return;
    }
    const activeRules = this.settings.rules.filter((r) => r.enabled);

    // 1. Obsidian Bases Table Views
    for (const table of document.querySelectorAll(".bases-view .bases-table")) {
      const headers = [...table.querySelectorAll(".bases-thead .bases-th")].map((th) =>
        (th.getAttribute("data-property") || th.textContent || "").trim()
      );
      for (const row of table.querySelectorAll(".bases-tbody .bases-tr")) {
        clearElementFormatting(row);
        const cells = [...row.querySelectorAll(".bases-td")];
        cells.forEach((cell, idx) => {
          const prop = cell.getAttribute("data-property") || headers[idx] || "";
          applyFormattingToCell(cell, row, prop, activeRules);
        });
      }
    }

    // 2. Obsidian Bases Card Views
    for (const card of document.querySelectorAll(".bases-view .bases-cards-item")) {
      clearElementFormatting(card);
      for (const propEl of card.querySelectorAll(".bases-cards-property")) {
        const prop =
          propEl.getAttribute("data-property") ||
          propEl.querySelector(".bases-cards-label")?.textContent?.trim() ||
          "";
        const valEl = propEl.querySelector(".bases-rendered-value, .metadata-property-value") || propEl;
        applyFormattingToCell(valEl, card, prop, activeRules);
      }
    }

    // 3. Optional Markdown & Dataview tables
    if (this.settings.applyToMarkdownTables) {
      for (const table of document.querySelectorAll(".markdown-preview-view table, .markdown-rendered table")) {
        if (table.closest(".bases-view")) continue;
        const headers = [...table.querySelectorAll("thead th")].map((th) => (th.textContent || "").trim());
        if (!headers.length) continue;
        for (const tr of table.querySelectorAll("tbody tr")) {
          clearElementFormatting(tr);
          const tds = [...tr.querySelectorAll("td")];
          tds.forEach((td, idx) => {
            applyFormattingToCell(td, tr, headers[idx] || "", activeRules);
          });
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Modals & Settings UI                                                */
/* ------------------------------------------------------------------ */

class PresetModal extends SuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Choose a formatting preset to add…");
  }
  getSuggestions(query) {
    const q = query.trim().toLowerCase();
    return RULE_PRESETS.filter((p) => !q || p.label.toLowerCase().includes(q));
  }
  renderSuggestion(item, el) {
    el.createDiv({ text: item.label });
  }
  onChooseSuggestion(item) {
    this.onChoose(item);
  }
}

class ImportRulesModal extends Modal {
  constructor(app, onImport) {
    super(app);
    this.onImport = onImport;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Import formatting rules (JSON)" });
    const ta = contentEl.createEl("textarea", { cls: "bcf-json-textarea" });
    ta.placeholder = '[{"name": "High CPA", "column": "ads_cpa", "operator": "gt", "value": "20", "styleMode": "badge", "color": "red"}]';
    const actions = contentEl.createDiv({ cls: "bcf-modal-actions" });
    const replaceBtn = actions.createEl("button", { text: "Replace all rules" });
    const appendBtn = actions.createEl("button", { text: "Append rules", cls: "mod-cta" });

    const run = async (replace) => {
      try {
        const rules = validateImportedRules(ta.value);
        await this.onImport(rules, replace);
        this.close();
      } catch (e) {
        new Notice(`Bases Conditional Format: ${e.message || e}`, 8000);
      }
    };
    replaceBtn.addEventListener("click", () => run(true));
    appendBtn.addEventListener("click", () => run(false));
  }
}

class BasesConditionalFormatSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.selectedPreset = RULE_PRESETS[0].id;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = async () => this.plugin.saveSettings();
    containerEl.empty();

    const intro = containerEl.createDiv({ cls: "setting-item-description bcf-intro" });
    intro.appendText("⭐ Enjoying Bases Conditional Format? A star on ");
    intro.createEl("a", { text: "GitHub", href: "https://github.com/chi-li-peppers/obsidian-bases-conditional-format" });
    intro.appendText(" helps others find it. Ideas or bugs? ");
    intro.createEl("a", { text: "Open an issue", href: "https://github.com/chi-li-peppers/obsidian-bases-conditional-format/issues" });
    intro.appendText(".");

    new Setting(containerEl)
      .setName("Enable conditional formatting")
      .setDesc("Apply colour badges, cell fills, row highlights and progress bars in Obsidian Bases.")
      .addToggle((t) => t.setValue(s.enabled).onChange(async (v) => ((s.enabled = v), await save())));

    new Setting(containerEl)
      .setName("Also apply to Markdown and Dataview tables")
      .setDesc("Matches standard reading-view tables using their column header names.")
      .addToggle((t) => t.setValue(s.applyToMarkdownTables).onChange(async (v) => ((s.applyToMarkdownTables = v), await save())));

    new Setting(containerEl).setName("Quick presets").setHeading();

    new Setting(containerEl)
      .setName("Add rules from preset")
      .setDesc("Insert ready-made rules for Ad CPA, task statuses, priorities, due dates or progress bars.")
      .addDropdown((d) => {
        for (const p of RULE_PRESETS) d.addOption(p.id, p.label);
        d.setValue(this.selectedPreset).onChange((v) => (this.selectedPreset = v));
      })
      .addButton((b) =>
        b.setButtonText("Add preset").setCta().onClick(async () => {
          const p = RULE_PRESETS.find((x) => x.id === this.selectedPreset);
          if (!p) return;
          for (const r of p.rules) s.rules.push(makeRule(r));
          await save();
          new Notice(`Bases Conditional Format: added ${p.rules.length} rule(s)`);
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Rules")
      .setHeading()
      .addButton((b) =>
        b.setButtonText("Add rule").setCta().onClick(async () => {
          s.rules.push(makeRule({ name: `Rule ${s.rules.length + 1}` }));
          await save();
          this.display();
        })
      )
      .addButton((b) =>
        b.setButtonText("Export JSON").onClick(async () => {
          await navigator.clipboard.writeText(JSON.stringify(s.rules, null, 2));
          new Notice("Bases Conditional Format: rules JSON copied to clipboard");
        })
      )
      .addButton((b) =>
        b.setButtonText("Import JSON").onClick(() => {
          new ImportRulesModal(this.app, async (imported, replace) => {
            s.rules = replace ? imported : s.rules.concat(imported);
            await save();
            new Notice(`Bases Conditional Format: imported ${imported.length} rule(s)`);
            this.display();
          }).open();
        })
      );

    if (!s.rules.length) {
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: "No rules yet. Pick a preset above or press “Add rule” to create your first rule.",
      });
    }

    s.rules.forEach((rule, idx) => {
      const card = containerEl.createDiv({ cls: "bcf-rule-card" });

      const header = card.createDiv({ cls: "bcf-rule-header" });
      const titleInput = header.createEl("input", { type: "text", cls: "bcf-rule-title" });
      titleInput.value = rule.name;
      titleInput.placeholder = "Rule name";
      titleInput.addEventListener("input", async () => {
        rule.name = titleInput.value;
        await save();
      });

      const controls = header.createDiv({ cls: "bcf-rule-controls" });
      const toggle = controls.createEl("input", { type: "checkbox" });
      toggle.checked = rule.enabled;
      toggle.title = "Enable rule";
      toggle.addEventListener("change", async () => {
        rule.enabled = toggle.checked;
        await save();
      });

      const upBtn = controls.createEl("button", { text: "↑" });
      upBtn.disabled = idx === 0;
      upBtn.addEventListener("click", async () => {
        [s.rules[idx - 1], s.rules[idx]] = [s.rules[idx], s.rules[idx - 1]];
        await save();
        this.display();
      });

      const downBtn = controls.createEl("button", { text: "↓" });
      downBtn.disabled = idx === s.rules.length - 1;
      downBtn.addEventListener("click", async () => {
        [s.rules[idx + 1], s.rules[idx]] = [s.rules[idx], s.rules[idx + 1]];
        await save();
        this.display();
      });

      const delBtn = controls.createEl("button", { text: "Delete" });
      delBtn.addEventListener("click", async () => {
        s.rules.splice(idx, 1);
        await save();
        this.display();
      });

      const grid = card.createDiv({ cls: "bcf-rule-grid" });

      const addInput = (labelText, value, placeholder, onChange) => {
        const wrap = grid.createDiv({ cls: "bcf-field" });
        wrap.createEl("label", { text: labelText });
        const inp = wrap.createEl("input", { type: "text" });
        inp.value = String(value ?? "");
        inp.placeholder = placeholder || "";
        inp.addEventListener("input", async () => {
          onChange(inp.value);
          updatePreview();
          await save();
        });
        return inp;
      };

      const addSelect = (labelText, options, value, onChange, redraw) => {
        const wrap = grid.createDiv({ cls: "bcf-field" });
        wrap.createEl("label", { text: labelText });
        const sel = wrap.createEl("select", { cls: "dropdown" });
        for (const o of options) {
          const opt = sel.createEl("option", { value: o.id, text: o.label });
          if (o.id === value) opt.selected = true;
        }
        sel.addEventListener("change", async () => {
          onChange(sel.value);
          await save();
          if (redraw) this.display();
          else updatePreview();
        });
      };

      addInput("Column(s) or *", rule.column, "status, ads_cpa, *", (v) => (rule.column = v));
      addSelect("Condition", OPERATORS, rule.operator, (v) => (rule.operator = v), true);

      const needsVal = !["is_empty", "is_not_empty", "date_before_today", "date_is_today", "always"].includes(rule.operator);
      if (needsVal) {
        addInput(rule.operator === "between" ? "Min value" : "Value", rule.value, "e.g. 20 or done", (v) => (rule.value = v));
      }
      if (rule.operator === "between") {
        addInput("Max value", rule.value2, "e.g. 50", (v) => (rule.value2 = v));
      }

      addSelect("Style", STYLE_MODES, rule.styleMode, (v) => (rule.styleMode = v), true);
      addSelect(
        "Colour",
        COLORS.map((c) => ({ id: c, label: c[0].toUpperCase() + c.slice(1) })),
        rule.color,
        (v) => (rule.color = v),
        true
      );

      if (rule.color === "custom") {
        addInput("Custom CSS colour", rule.customColor, "#ff5500", (v) => (rule.customColor = v));
      }
      if (rule.styleMode === "bar") {
        addInput("Bar min", rule.barMin, "0", (v) => (rule.barMin = Number(v) || 0));
        addInput("Bar max", rule.barMax, "100", (v) => (rule.barMax = Number(v) || 100));
      }
      addInput("Icon / emoji", rule.icon, "optional, e.g. 🟢", (v) => (rule.icon = v));

      const footer = card.createDiv({ cls: "bcf-rule-footer" });
      const flags = footer.createDiv({ cls: "bcf-flags" });

      const addFlag = (labelText, checked, onChange) => {
        const lbl = flags.createEl("label");
        const cb = lbl.createEl("input", { type: "checkbox" });
        cb.checked = checked;
        cb.addEventListener("change", async () => {
          onChange(cb.checked);
          updatePreview();
          await save();
        });
        lbl.appendText(labelText);
      };

      addFlag("Bold", rule.bold, (v) => (rule.bold = v));
      addFlag("Strikethrough", rule.strikethrough, (v) => (rule.strikethrough = v));
      addFlag("Stop on match", rule.stopOnMatch, (v) => (rule.stopOnMatch = v));

      const previewWrap = footer.createDiv({ cls: "bcf-preview-wrap" });
      previewWrap.createSpan({ text: "Preview:" });
      const sample = previewWrap.createSpan({ cls: "bcf-preview-sample", text: rule.styleMode === "bar" ? "65%" : rule.value || "Sample" });

      const updatePreview = () => {
        clearElementFormatting(sample);
        sample.classList.remove("bcf-preview-pill");
        const colorCls = `bcf-color-${COLORS.includes(rule.color) ? rule.color : "blue"}`;
        if (rule.styleMode === "row") {
          sample.classList.add("bcf-row-matched", colorCls);
        } else {
          sample.classList.add("bcf-matched", `bcf-mode-${rule.styleMode}`, colorCls);
          if (rule.styleMode === "badge") sample.classList.add("bcf-preview-pill");
        }
        if (rule.color === "custom" && rule.customColor) {
          applyCssProps(sample, { "--bcf-custom-color": rule.customColor });
        }
        if (rule.styleMode === "bar") {
          applyCssProps(sample, { "--bcf-bar-pct": "65%" });
          sample.setText("65%");
        } else {
          sample.setText(rule.value || "Sample");
        }
        if (rule.icon) {
          sample.classList.add("bcf-has-icon");
          sample.setAttribute("data-bcf-icon", rule.icon);
        }
        if (rule.bold) sample.classList.add("bcf-bold");
        if (rule.strikethrough) sample.classList.add("bcf-strike");
      };
      updatePreview();
    });
  }
}

module.exports = BasesConditionalFormatPlugin;
module.exports.default = BasesConditionalFormatPlugin;
module.exports._internals = {
  makeRule,
  parseNumericValue,
  parseDateValue,
  stripPropertyPrefix,
  matchesColumn,
  evaluateRule,
  computeBarPct,
  resolveFormatting,
  validateImportedRules,
  RULE_PRESETS,
};
