import type { Args, Content, Dyn, DynContent, RowArgs, RowOf } from "./args";
import { FieldBuilder, type AnyField, type Bindable, type Field, type FieldDef } from "./field";
import { RESERVED_KINDS, type Kinds, type ReservedKind } from "./kind";
import type { Element, Path, PathValue, RowsPath } from "./path";

/**
 * Fields of a section or list row, keyed by path.
 * - Key = typed path into the scope `S`; the field must be able to show the value there.
 * - No index signature on purpose: it would switch off the check for unknown keys.
 * - Content without a value goes to a section's `before`/`after`.
 */
export type FieldMap<S> = { [K in Path<S>]?: Bindable<PathValue<S, K>> };

/** A field that shows content and holds no value (`display`, `note`). */
export type ContentField<A, S> = Field<unknown, A, S> & { readonly "~content": true };

/**
 * Columns of a list as written.
 * - Path keys: the field must fit the value there (like `FieldMap`).
 * - Other keys: only content fields (`total: r.display(...)`); an input under an unknown key
 *   is a typo and fails.
 */
export type Columns<R, X> = {
  [K in keyof X]: K extends Path<R> ? Bindable<PathValue<R, K>> : { readonly "~content": true };
};

/** Stringified values a `when` can switch on. */
type CaseKey<V> = `${Extract<NonNullable<V>, string | number | boolean>}`;

/** Union of the values the cases of a `when` edit. */
type CaseValue<C> = {
  [K in keyof C]-?: NonNullable<C[K]> extends { readonly "~value"?: (value: infer V) => void } ? V : never;
}[keyof C];

/** Add button of a list: label, label plus the new row, or `false` for none. */
export type AddOption<R, LA> = string | false | { readonly label: string; readonly row?: (args: LA) => Partial<R> };

/**
 * Options of a list.
 * - Row-level callbacks (`removable`) receive `RowArgs`, list-level ones (`add`, `picker`,
 *   `summary`) the list arguments: no row, but `parent` in nested lists.
 */
export interface RowsOptions<R, A> {
  /** Presentation; the kit decides the default. */
  readonly as?: "table" | "cards" | "inline";
  /** Add button; a function decides per case (`false` = none). */
  readonly add?: AddOption<R, ListArgs<A>> | ((args: ListArgs<A>) => AddOption<R, ListArgs<A>>);
  readonly sortable?: boolean;
  readonly removable?: boolean | ((args: A) => boolean);
  readonly min?: number;
  readonly max?: number;
  /** Text when the list is empty. */
  readonly empty?: string;
  /**
   * Add rows by picking from a list (`f.picker(...)`); a function decides per case (`undefined` = none).
   * - Return a picker defined once (a `const` in the definition) to keep re-renders down.
   */
  readonly picker?: Picker<R> | ((args: ListArgs<A>) => Picker<R> | undefined);
  /** Content below the rows (totals). */
  readonly summary?: (args: ListArgs<A>) => Content;
}

/** Arguments of list-level callbacks: the row arguments without row and index. */
export type ListArgs<A> = Omit<A, "row" | "index">;

/**
 * Options of a picker.
 * - `Item`: what is picked (inferred from `items`), `R`: the list's row type, `A`: form arguments
 */
export interface PickerOptions<Item, R, A> {
  readonly items: (args: A) => readonly Item[];
  /** Identity of an item. */
  readonly key: (item: Item) => string;
  /** The row an item becomes; missing columns get their empty value. */
  readonly toRow: (item: Item, args: A) => Partial<R>;
  /** What the picker shows per item (kit content). */
  readonly label: (item: Item) => Content;
  /** Searchable text per item; default: the label when it is a string. */
  readonly search?: (item: Item) => string;
  /** Row path holding the item key: items already in the list are disabled. */
  readonly unique?: Path<R>;
  /** `"sidebar"`: left column of the dialog (without panels); `"inline"`: above the rows. Default: `"inline"`. */
  readonly placement?: "sidebar" | "inline";
  readonly placeholder?: string;
  /** Text when nothing matches. */
  readonly empty?: string;
  /** Extra entry that adds a row not taken from the items. */
  readonly custom?: { readonly label: string; readonly row: (args: A) => Partial<R> };
  /** Picking is disabled (e.g. until a customer is chosen). */
  readonly disabled?: (args: A) => boolean;
}

/** A picker for a list of `R`; the phantom checks that its rows fit the list. */
export interface Picker<R> {
  readonly "~row"?: (row: R) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly options: PickerOptions<any, unknown, never>;
}

/** A list of rows; behaves like a field (label, `.if`, `.wide`, …). */
export type Rows<R, A, S> = Field<R[], A, S>;

/** Builders the engine provides in every form. */
interface Builtins<K extends Kinds, T, C, P, A, S> {
  /**
   * One field, a different variant per value at `path`.
   * - Values without a case hide the field.
   */
  when<Q extends Path<S>, Cases extends { [V in CaseKey<PathValue<S, Q>>]?: AnyField }>(
    path: Q,
    // - rejects cases for values the path cannot hold
    cases: Cases & Record<Exclude<keyof Cases, CaseKey<PathValue<S, Q>>>, never>,
  ): Field<CaseValue<Cases>, A, S>;

  /**
   * A list of rows.
   * - Columns are built with the row factory `r`; their paths and `row` are typed by the list.
   */
  rows<R, X>(
    // - R comes from the path the list is bound to, never from the columns
    // - a list inside a row gets that row as `parent`
    // - X: the columns as written; free keys are allowed for content (`total: r.display(...)`)
    columns: (r: Factory<K, T, C, P, RowArgs<T, C, P, R, RowOf<A>>, R>) => X & Columns<R, X>,
    options?: NoInfer<RowsOptions<R, RowArgs<T, C, P, R, RowOf<A>>>>,
  ): Rows<R, A, S>;

  /**
   * A picker for `rows(..., { picker })`: pick items, each becomes a row.
   * - `Item` is inferred from `items`; the row type comes from the list.
   * - `f.picker` for top-level lists; `r.picker` for a list nested in a row (gets `parent`).
   */
  // - `R` comes from the list the picker is placed in (contextual return), never from `toRow`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  picker<Item, R = any>(options: PickerOptions<Item, NoInfer<R>, ListArgsIn<A>>): Picker<R>;
  /**
   * The same, typed by the list it is for: use it when the picker is defined ahead
   * (`const p = f.picker("items", { … })`), where the list cannot lend its row type.
   */
  picker<Q extends RowsPath<S>, Item>(path: Q, options: PickerOptions<Item, Element<PathValue<S, Q>>, ListArgsIn<A>>): Picker<Element<PathValue<S, Q>>>;

  /** Read-only content derived from the arguments (totals, previews). */
  display(render: (args: A) => Content): ContentField<A, S>;

  /** Static or derived note (explanations, links). */
  note(content: DynContent<A>): ContentField<A, S>;

  /**
   * Escape hatch: a component that edits the value itself.
   * - Gets the engine's field API, keeps validation, errors and saving.
   */
  custom<V = unknown>(component: unknown): Field<V, A, S>;
}

/** Kind builders from the kit: `f.<kind>(label, ...params)`. */
type KindBuilders<K extends Kinds, A, S> = {
  [N in Exclude<keyof K, ReservedKind>]: K[N] extends {
    readonly "~types"?: { value: infer V; params: infer Params; config: infer Config };
  }
    ? Params extends unknown[]
      ? (label: Dyn<string | undefined, A>, ...params: Params) => Field<V, A, S, Config>
      : never
    : never;
};

/** Arguments of a list created in scope `A`: form arguments, plus `parent` when `A` is a row. */
export type ListArgsIn<A> = Omit<A, "row" | "index" | "parent"> & { readonly parent: RowOf<A> };

/**
 * The `f` handed to a form definition.
 * - `T`: form values, `C`: context, `P`: props
 * - `A`/`S`: arguments and path scope (form level or a list row)
 */
export type Factory<K extends Kinds, T, C, P, A = Args<T, C, P>, S = T> = KindBuilders<K, A, S> & Builtins<K, T, C, P, A, S>;

// ── runtime ────────────────────────────────────────────────────────────────

/** A field after normalization: its key and its accumulated definition. */
export interface Entry {
  readonly key: string;
  readonly def: FieldDef;
}

/** Turn a field map into ordered entries. */
export function entries(map: Record<string, AnyField | undefined>): Entry[] {
  return Object.entries(map).flatMap(([key, field]) => (field ? [{ key, def: field.def }] : []));
}

/**
 * Build the runtime factory for a kit.
 * - Type-level scopes (form vs row) do not exist at runtime: one object serves both.
 */
export function createFactory<K extends Kinds>(kinds: K): Factory<K, unknown, unknown, unknown> {
  for (const name of RESERVED_KINDS) {
    if (name in kinds) throw new Error(`form-engine: kind name "${name}" is reserved`);
  }
  const field = (def: FieldDef) => new FieldBuilder(def);
  const factory: Record<string, unknown> = {};

  for (const [name, k] of Object.entries(kinds)) {
    factory[name] = (label: unknown, ...params: unknown[]) =>
      field({ kind: name, label: label as FieldDef["label"], config: k.setup?.(...params) });
  }

  factory.when = (path: string, cases: Record<string, FieldBuilder | undefined>) =>
    field({
      kind: "when",
      cases: {
        path,
        fields: Object.fromEntries(Object.entries(cases).flatMap(([v, c]) => (c ? [[v, c.def]] : []))),
      },
    });

  factory.rows = (columns: (r: unknown) => Record<string, FieldBuilder | undefined>, options?: RowsOptions<unknown, never>) =>
    field({ kind: "rows", config: { columns: entries(columns(factory) as never), options: options ?? {} } });

  // - the path form only types the rows: at runtime both forms carry just the options
  factory.picker = (pathOrOptions: unknown, options?: unknown) => ({ options: typeof pathOrOptions === "string" ? options : pathOrOptions });
  factory.display = (render: unknown) => field({ kind: "display", config: { render } });
  factory.note = (content: unknown) => field({ kind: "note", config: { content } });
  factory.custom = (component: unknown) => field({ kind: "custom", config: { component } });

  return factory as Factory<K, unknown, unknown, unknown>;
}
