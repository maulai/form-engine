import type { Dyn, Hint } from "./args";
import type { Path, PathValue } from "./path";

/**
 * Visibility condition, kept as data so the runtime can track dependencies.
 * - `path`: value at `path` (relative to the scope: form or row) is present,
 *   or equals one of `equals`
 * - `test`: arbitrary predicate over the arguments
 * - `edit`: only when creating (`false`) or only when editing (`true`)
 */
export type Condition =
  | { readonly type: "path"; readonly path: string; readonly equals?: readonly unknown[] }
  | { readonly type: "test"; readonly test: (args: never) => boolean }
  | { readonly type: "edit"; readonly edit: boolean };

/** Effect tools handed to `onChange`. Paths are relative to the scope. */
export interface ChangeTools<S, A> {
  readonly set: <K extends Path<S>>(path: K, value: PathValue<S, K>) => void;
  readonly args: A;
}

/** Plain data a field builder accumulates. Read by the runtime, never by forms. */
export interface FieldDef {
  /** Kind name from the kit, or an engine kind (`when`, `display`, `custom`, …). */
  readonly kind: string;
  /** Kind-specific configuration produced by the kind's `setup`. */
  readonly config?: unknown;
  readonly label?: Dyn<string, never>;
  readonly hint?: Dyn<Hint | undefined, never>;
  readonly placeholder?: Dyn<string, never>;
  readonly wide?: boolean;
  readonly conditions?: readonly Condition[];
  readonly readOnly?: Dyn<boolean, never>;
  readonly lockedOnEdit?: boolean;
  readonly fixed?: (args: never) => unknown;
  readonly onChange?: (value: never, tools: never) => void | Promise<void>;
  /** Per-evaluation config, merged over `config` (dependent options). */
  readonly dynamicConfig?: (args: never) => object;
  /** Each value at most once across the rows of its list. */
  readonly unique?: boolean;
  /** `when`: the variants keyed by the stringified value at `path`. */
  readonly cases?: { readonly path: string; readonly fields: Readonly<Record<string, FieldDef>> };
}

/**
 * What a field map accepts at a path whose value is `V`.
 * - Only the phantom is compared: a field fits when it can show every value at the path.
 */
export interface Bindable<V> {
  readonly "~value"?: (value: NonNullable<V>) => void;
  readonly def: FieldDef;
}

/** Any field, regardless of its value. */
export type AnyField = Bindable<never>;

/**
 * A field in a form or a list row.
 * - `V`: value the field edits
 * - `A`: arguments of dynamic properties (`Args` or `RowArgs`)
 * - `S`: scope that path-based conditions and `onChange.set` refer to
 * - `Config`: the kind's config (what `.config(fn)` may override)
 */
export interface Field<V, A, S, Config = unknown> {
  /** - phantom, contravariant: a field can bind to a path whose values it can show */
  readonly "~value"?: (value: NonNullable<V>) => void;
  readonly def: FieldDef;

  /** Span the full width of the section grid. */
  wide(): this;
  /** Show only when the value at `path` is present, or equals one of `values`. */
  if<P extends Path<S>>(path: P, ...values: NonNullable<PathValue<S, P>>[]): this;
  /** Show only when the predicate holds. */
  if(test: (args: A) => boolean): this;
  /** Show only when creating a new record. */
  createOnly(): this;
  /** Show only when editing an existing record. */
  editOnly(): this;

  label(label: Dyn<string | undefined, A>): this;
  hint(hint: Dyn<Hint | undefined, A>): this;
  placeholder(placeholder: Dyn<string | undefined, A>): this;

  /** Render the read view of the same kind. */
  readOnly(readOnly?: Dyn<boolean, A>): this;
  /** Editable on create, read-only on edit (keys, identities). */
  lockedOnEdit(): this;
  /**
   * Value given by the caller: when `fn` returns a value, the field is set to it
   * and shown read-only; `undefined` leaves the field editable.
   */
  fixed(fn: (args: A) => V | undefined): this;
  /** React to user changes only; never runs on open or on programmatic sets. */
  onChange(effect: (value: V, tools: ChangeTools<S, A>) => void | Promise<void>): this;
  /**
   * Config that depends on values, context or the row (options of a choice).
   * - Merged over the config from the builder's parameters on every evaluation.
   * - Kept by identity while the result is structurally equal: no extra re-renders.
   */
  config(fn: (args: A) => Partial<Config>): this;
  /**
   * In a list: each value at most once across the rows.
   * - Options other rows use are left out (kinds with `options` and `withOptions`).
   * - A new row gets the first free value; adding stops when none is left.
   */
  unique(): this;
}

/** Runtime implementation shared by all kinds. Immutable: every call returns a copy. */
export class FieldBuilder {
  constructor(readonly def: FieldDef) {}

  protected with(patch: Partial<FieldDef>): this {
    const Ctor = this.constructor as new (def: FieldDef) => this;
    return new Ctor({ ...this.def, ...patch });
  }

  protected condition(condition: Condition): this {
    return this.with({ conditions: [...(this.def.conditions ?? []), condition] });
  }

  wide() {
    return this.with({ wide: true });
  }

  if(pathOrTest: string | ((args: never) => boolean), ...equals: unknown[]) {
    return this.condition(
      typeof pathOrTest === "function"
        ? { type: "test", test: pathOrTest }
        : { type: "path", path: pathOrTest, ...(equals.length > 0 && { equals }) },
    );
  }

  createOnly() {
    return this.condition({ type: "edit", edit: false });
  }

  editOnly() {
    return this.condition({ type: "edit", edit: true });
  }

  label(label: Dyn<string, never>) {
    return this.with({ label });
  }

  hint(hint: Dyn<Hint | undefined, never>) {
    return this.with({ hint });
  }

  placeholder(placeholder: Dyn<string, never>) {
    return this.with({ placeholder });
  }

  readOnly(readOnly: Dyn<boolean, never> = true) {
    return this.with({ readOnly });
  }

  lockedOnEdit() {
    return this.with({ lockedOnEdit: true });
  }

  fixed(fixed: (args: never) => unknown) {
    return this.with({ fixed });
  }

  onChange(onChange: (value: never, tools: never) => void | Promise<void>) {
    return this.with({ onChange });
  }

  unique() {
    return this.with({ unique: true });
  }

  config(dynamicConfig: (args: never) => object) {
    return this.with({ dynamicConfig });
  }
}
