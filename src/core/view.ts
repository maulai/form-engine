import { resolve, type Content, type Dyn, type Hint } from "./args";
import type { AddOption, Entry, Picker, RowsOptions } from "./factory";

/** Rows options after evaluation: `add` and `picker` resolved for the current case. */
export type ResolvedRowsOptions = Omit<RowsOptions<unknown, never>, "add" | "picker"> & {
  readonly add?: AddOption<unknown, never>;
  readonly picker?: Picker<unknown>;
};
import type { Condition, FieldDef } from "./field";
import { CONTENT_KINDS, type Kinds } from "./kind";
import { configFor, narrowUnique } from "./unique";
import { getPath, isPresent } from "./path";
import type { PanelData, PanelStatus, SectionData, SpecData } from "./spec";

/** Input of one evaluation. */
export interface EvaluateInput {
  readonly spec: SpecData;
  readonly values: unknown;
  readonly ctx?: unknown;
  readonly props?: unknown;
  readonly edit?: boolean;
  /** Read-only view: every field (and list) is read-only. */
  readonly readOnly?: boolean;
  /** Authored index of the panel the user looks at; falls back to the first visible one. */
  readonly activePanel?: number;
  /**
   * Cache across evaluations (one per form session).
   * - Keeps derived configs and list options by identity while they are structurally equal.
   */
  readonly memo?: Map<string, unknown>;
  /** The kit's kinds; needed for `.unique()` (their `options` / `withOptions`). */
  readonly kinds?: Kinds;
}

/** Where a field sits: the row it belongs to and that row's enclosing row. */
export interface FieldScope {
  /** Row path (`items.2`), `""` at form level. */
  readonly scope: string;
  readonly index?: number;
  /** Enclosing row of `scope` in nested lists (`items.2` for `items.2.parts.0`). */
  readonly parentScope?: string;
}

/** A visible field, fully resolved for rendering. */
export interface FieldView extends FieldScope {
  /** Key as authored (relative to its scope). */
  readonly key: string;
  /** Absolute dot path into the form values. */
  readonly path: string;
  /** Effective kind; for `when` the kind of the active case. */
  readonly kind: string;
  /** Config from the builder's parameters, with `.config(fn)` merged in. */
  readonly config: unknown;
  readonly label?: string;
  readonly hint?: Hint;
  readonly placeholder?: string;
  readonly wide: boolean;
  readonly readOnly: boolean;
  /** Content of `display` / `note`. */
  readonly content?: Content;
  /** Rows of a `rows` field. */
  readonly rows?: readonly RowView[];
  /** Options of a `rows` field. */
  readonly rowsOptions?: ResolvedRowsOptions;
  /** Effective definition (modifiers of a `when` merged with its case). */
  readonly def: FieldDef;
}

export interface RowView {
  readonly index: number;
  /** Absolute path of the row (`addresses.2`). */
  readonly path: string;
  readonly fields: readonly FieldView[];
}

export interface SectionView {
  readonly index: number;
  readonly name?: string;
  readonly description?: string;
  readonly before?: Content;
  readonly after?: Content;
  readonly fields: readonly FieldView[];
}

export interface PanelView {
  /** Authored index; stable while other panels appear or disappear. */
  readonly index: number;
  readonly name: string;
  readonly status?: PanelStatus;
  readonly active: boolean;
  /** Sections; empty for panels that are not active (they are not rendered). */
  readonly sections: readonly SectionView[];
}

/**
 * Every value-bearing field, visible or not.
 * - Input for the hidden-value rules, fixed values and error routing.
 */
export interface Slot extends FieldScope {
  readonly path: string;
  readonly def: FieldDef;
  /** Resolved config (with `.config(fn)`); for hidden slots the static one. */
  readonly config: unknown;
  readonly visible: boolean;
  /** In the panel the user looks at. */
  readonly active: boolean;
  /** Authored panel index. */
  readonly panel: number;
  /** Set when the caller fixes the value. */
  readonly fixed?: { readonly value: unknown };
}

export interface View {
  readonly title?: string;
  readonly description?: string;
  readonly navigation: boolean;
  /** Visible panels only. */
  readonly panels: readonly PanelView[];
  /** Authored index of the active panel, `-1` when no panel is visible. */
  readonly activePanel: number;
  readonly slots: readonly Slot[];
}

// ── evaluation ─────────────────────────────────────────────────────────────

type AnyArgs = { values: unknown; ctx: unknown; props: unknown; edit: boolean; row?: unknown; index?: number; parent?: unknown };

/**
 * Equality for derived configs and options.
 * - Structural for arrays and plain objects, a few levels deep; functions by identity.
 * - Framework elements (`$$typeof`) by identity: they may be cyclic.
 */
function similar(a: unknown, b: unknown, depth = 4): boolean {
  if (Object.is(a, b)) return true;
  if (depth === 0 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if ("$$typeof" in a || "$$typeof" in b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Map && b instanceof Map) {
    return a.size === b.size && [...a].every(([k, v]) => b.has(k) && similar(v, b.get(k), depth - 1));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => similar((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth - 1));
}

/** Return the cached value when the new one is similar: derived objects keep their identity. */
function stable<V>(memo: Map<string, unknown> | undefined, key: string, value: V): V {
  if (!memo) return value;
  const last = memo.get(key) as V | undefined;
  if (last !== undefined && similar(last, value)) return last;
  memo.set(key, value);
  return value;
}

/** List-level arguments: no row, the enclosing row as `parent`. */
function listArgs(args: AnyArgs): AnyArgs {
  const { row, index: _index, parent: _parent, ...rest } = args;
  return { ...rest, parent: row };
}

const call = <R>(value: Dyn<R, never> | undefined, args: AnyArgs): R | undefined =>
  value === undefined ? undefined : resolve(value as Dyn<R, AnyArgs>, args);

export function passes(conditions: readonly Condition[] | undefined, scope: unknown, args: AnyArgs): boolean {
  for (const c of conditions ?? []) {
    if (c.type === "edit" && c.edit !== args.edit) return false;
    if (c.type === "test" && !(c.test as (a: AnyArgs) => boolean)(args)) return false;
    if (c.type === "path") {
      const value = getPath(scope, c.path);
      if (c.equals ? !c.equals.includes(value) : !isPresent(value)) return false;
    }
  }
  return true;
}

/** Section / panel condition: a path that must be present, or a predicate. */
function holds(condition: string | ((args: never) => boolean) | undefined, args: AnyArgs): boolean {
  if (condition === undefined) return true;
  if (typeof condition === "string") return isPresent(getPath(args.values, condition));
  return (condition as (a: AnyArgs) => boolean)(args);
}

/**
 * Effective definition of a `when`.
 * - Modifiers of the `when` itself (`.if`, `.wide`, …) apply to every case.
 * - The case wins for everything it sets; conditions add up.
 */
function pickCase(def: FieldDef, scope: unknown): FieldDef | undefined {
  if (def.kind !== "when" || !def.cases) return def;
  const selected = def.cases.fields[String(getPath(scope, def.cases.path))];
  if (!selected) return undefined;
  const { cases: _cases, kind: _kind, ...outer } = def;
  return { ...outer, ...selected, conditions: [...(def.conditions ?? []), ...(selected.conditions ?? [])] };
}

interface Walk {
  readonly args: AnyArgs;
  readonly slots: Slot[];
  readonly panel: number;
  readonly active: boolean;
  readonly memo: Map<string, unknown> | undefined;
  /** Enclosing row path of the current row (nested lists). */
  readonly parentScope: string | undefined;
  readonly kinds: Kinds | undefined;
  /** Rows of the list the current row belongs to (for `.unique()`). */
  readonly list: readonly unknown[] | undefined;
  /** The whole form is a read-only view. */
  readonly readOnly: boolean;
}

/** Static config with `.config(fn)` merged in, stable by identity while similar. */
function configOf(def: FieldDef, path: string, key: string, w: Walk): unknown {
  let config = configFor(def, w.args);
  // - `.unique()`: leave out what the other rows of the list use
  if (def.unique && w.list && w.args.index !== undefined) {
    const own = getPath(w.args.row, key);
    const used = w.list.filter((_, i) => i !== w.args.index).map((r) => getPath(r, key));
    config = narrowUnique(w.kinds?.[def.kind], config, own, used);
  }
  return config === def.config ? config : stable(w.memo, `${path}#config`, config);
}

/** Rows options with `add` / `picker` functions resolved for the current case. */
function rowsOptionsOf(options: Record<string, unknown>, path: string, w: Walk): ResolvedRowsOptions {
  if (typeof options.add !== "function" && typeof options.picker !== "function") return options as ResolvedRowsOptions;
  const la = listArgs(w.args);
  const resolved = { ...options };
  if (typeof options.add === "function") resolved.add = (options.add as (a: AnyArgs) => unknown)(la);
  if (typeof options.picker === "function") resolved.picker = (options.picker as (a: AnyArgs) => unknown)(la);
  return stable(w.memo, `${path}#rows`, resolved) as ResolvedRowsOptions;
}

function walkField(entry: Entry, base: string, scope: unknown, parentVisible: boolean, w: Walk): FieldView | undefined {
  const path = base ? `${base}.${entry.key}` : entry.key;
  const picked = pickCase(entry.def, scope);
  const def = picked ?? entry.def;
  const visible = parentVisible && picked !== undefined && passes(def.conditions, scope, w.args);
  const where: FieldScope = {
    scope: base,
    ...(w.args.index !== undefined && { index: w.args.index }),
    ...(w.parentScope !== undefined && { parentScope: w.parentScope }),
  };
  // - derived config only for visible fields: hidden ones are not rendered
  const config = visible ? configOf(def, path, entry.key, w) : def.config;

  const fixedValue = def.fixed ? (def.fixed as (a: AnyArgs) => unknown)(w.args) : undefined;
  const fixed = fixedValue === undefined ? undefined : { value: fixedValue };
  if (!CONTENT_KINDS.includes(def.kind)) {
    w.slots.push({ path, def, config, visible, active: w.active, panel: w.panel, ...where, ...(fixed && { fixed }) });
  }
  if (!visible) return undefined;

  const staticConfig = def.config as Record<string, unknown> | undefined;
  let rows: RowView[] | undefined;
  let rowsOptions: ResolvedRowsOptions | undefined;
  if (def.kind === "rows") {
    const columns = (staticConfig?.columns ?? []) as Entry[];
    const list = getPath(scope, entry.key);
    rows = (Array.isArray(list) ? list : []).map((row, index) => {
      const rowPath = `${path}.${index}`;
      // - a list inside a row: that row becomes `parent` of the inner rows
      const rowWalk: Walk = { ...w, args: { ...w.args, row, index, parent: w.args.row }, parentScope: base || undefined, list: list as unknown[] };
      const fields = columns.flatMap((c) => walkField(c, rowPath, row, true, rowWalk) ?? []);
      return { index, path: rowPath, fields };
    });
    rowsOptions = rowsOptionsOf((staticConfig?.options ?? {}) as Record<string, unknown>, path, w);
  }

  const content =
    def.kind === "display"
      ? (staticConfig?.render as (a: AnyArgs) => Content)(w.args)
      : def.kind === "note"
        ? call<Content>(staticConfig?.content as Dyn<Content, never>, w.args)
        : undefined;

  const label = call<string>(def.label, w.args);
  const hint = call<Hint | undefined>(def.hint, w.args);
  const placeholder = call<string>(def.placeholder, w.args);
  return {
    key: entry.key,
    path,
    kind: def.kind,
    config,
    wide: def.wide ?? false,
    readOnly: w.readOnly || Boolean(call<boolean>(def.readOnly, w.args)) || (def.lockedOnEdit === true && w.args.edit) || fixed !== undefined,
    def,
    ...where,
    ...(label !== undefined && { label }),
    ...(hint !== undefined && { hint }),
    ...(placeholder !== undefined && { placeholder }),
    ...(content !== undefined && { content }),
    ...(rows && { rows, ...(rowsOptions && { rowsOptions }) }),
  };
}

function walkSection(section: SectionData, index: number, visible: boolean, w: Walk): SectionView | undefined {
  const shown = visible && holds(section.if, w.args);
  const fields = section.fields.flatMap((e) => walkField(e, "", w.args.values, shown, w) ?? []);
  if (!shown) return undefined;
  const name = call<string>(section.name, w.args);
  const description = call<string>(section.description, w.args);
  const before = call<Content>(section.before, w.args);
  const after = call<Content>(section.after, w.args);
  return {
    index,
    fields,
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(before !== undefined && { before }),
    ...(after !== undefined && { after }),
  };
}

/**
 * Resolve a spec against the current values.
 * - Pure: same input, same view; cheap enough to run on every change.
 * - Panels that are not active are walked for their slots but render no sections.
 */
export function evaluate(input: EvaluateInput): View {
  const { spec } = input;
  const args: AnyArgs = { values: input.values, ctx: input.ctx, props: input.props, edit: input.edit ?? false };
  const visibleIndexes = spec.panels.flatMap((p, i) => (holds(p.if, args) ? [i] : []));
  const activePanel = visibleIndexes.includes(input.activePanel ?? -1) ? input.activePanel! : (visibleIndexes[0] ?? -1);

  const slots: Slot[] = [];
  const panels: PanelView[] = [];
  spec.panels.forEach((panel: PanelData, index) => {
    const visible = visibleIndexes.includes(index);
    const w: Walk = { args, slots, panel: index, active: index === activePanel, memo: input.memo, parentScope: undefined, kinds: input.kinds, list: undefined, readOnly: input.readOnly === true };
    const sections = panel.sections.flatMap((s, si) => walkSection(s, si, visible, w) ?? []);
    if (!visible) return;
    const status = panel.status ? (panel.status as (a: AnyArgs) => PanelStatus | undefined)(args) : undefined;
    panels.push({
      index,
      name: panel.name,
      active: index === activePanel,
      sections: index === activePanel ? sections : [],
      ...(status !== undefined && { status }),
    });
  });

  const title = call<string | undefined>(spec.title, args);
  const description = call<string | undefined>(spec.description, args);
  return {
    navigation: spec.navigation,
    panels,
    activePanel,
    slots,
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
  };
}
