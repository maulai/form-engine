import type { Behavior } from "./behavior";
import type { FieldDef } from "./field";
import { singleOption, type Kinds } from "./kind";
import { getPath, unsetPath } from "./path";
import type { StandardSchemaV1 } from "./schema";
import type { Slot, View } from "./view";

/**
 * Optional knowledge about schemas, provided by the kit (e.g. reading a generated validator).
 * - One adapter per kit; it gets the schema of the form at hand (what `form(schema, …)` received).
 * - Paths are dot paths with row indexes (`items.2.qty`).
 */
export interface SchemaAdapter {
  /** Empty value at a path; `undefined` result means "unknown, ask the kind". */
  readonly emptyValue?: (path: string, schema: StandardSchemaV1) => { readonly value: unknown } | undefined;
  /** Whether the value at a path is required (for markers in labels). */
  readonly required?: (path: string, schema: StandardSchemaV1) => boolean;
}

/** A schema adapter bound to one form's schema. */
export interface SchemaInfo {
  readonly emptyValue?: (path: string) => { readonly value: unknown } | undefined;
  readonly required?: (path: string) => boolean;
}

/** Bind a kit's adapter to a form's schema. */
export function schemaInfo(adapter: SchemaAdapter | undefined, schema: StandardSchemaV1): SchemaInfo | undefined {
  if (!adapter) return undefined;
  const { emptyValue, required } = adapter;
  return {
    ...(emptyValue && { emptyValue: (path: string) => emptyValue(path, schema) }),
    ...(required && { required: (path: string) => required(path, schema) }),
  };
}

/** A value the binding should write. */
export interface ValueUpdate {
  readonly path: string;
  readonly value: unknown;
}

/**
 * Empty value of a field.
 * - Order: schema adapter → kind's `empty` → `[]` for lists → `undefined`.
 * - A `when` without an active case uses its first case's kind.
 */
export function emptyValueOf(path: string, def: FieldDef, kinds: Kinds, schema?: SchemaInfo): unknown {
  const known = schema?.emptyValue?.(path);
  if (known) return known.value;
  const kind = def.kind === "when" ? Object.values(def.cases?.fields ?? {})[0]?.kind : def.kind;
  if (kind === "rows") return [];
  return kind === undefined ? undefined : kinds[kind]?.empty;
}

/**
 * State of one form session (from open to close).
 * - Tracks which fields the user has seen, the basis of `"empty-if-seen"`.
 * - Reset on every open, otherwise a field seen for one record counts for the next.
 */
export class Session {
  private seen = new Set<string>();

  constructor(
    private readonly behavior: Pick<Behavior, "hidden"> & Partial<Pick<Behavior, "collapseSingleOption">>,
    private readonly kinds: Kinds,
    private readonly schema?: SchemaInfo,
  ) {}

  /** Whether a choice field is collapsed to its only option. */
  single(slotKind: string, config: unknown): { readonly value: unknown } | undefined {
    return this.behavior.collapseSingleOption ? singleOption(this.kinds[slotKind], config) : undefined;
  }

  reset(): void {
    this.seen = new Set();
  }

  /**
   * Updates the binding should apply after an evaluation.
   * - Fixed values that differ from the current ones.
   * - Visible choice fields with exactly one option and an empty value get that option.
   * - `"empty-if-seen"`: fields that were seen and are now hidden everywhere get their empty value.
   *   They leave the seen set, so they are cleared once, not on every evaluation.
   * - `keyOf`: identity of a path across row moves (the store's `keyedPath`); default: the path.
   */
  updates(view: View, values: unknown, keyOf: (path: string) => string = (p) => p): ValueUpdate[] {
    const updates: ValueUpdate[] = [];
    for (const slot of view.slots) {
      const current = getPath(values, slot.path);
      if (slot.fixed) {
        if (!Object.is(current, slot.fixed.value)) updates.push({ path: slot.path, value: slot.fixed.value });
        continue;
      }
      if (!slot.visible) continue;
      const only = this.single(slot.def.kind, slot.config);
      if (!only || Object.is(current, only.value)) continue;
      if (current === undefined || Object.is(current, emptyValueOf(slot.path, slot.def, this.kinds, this.schema))) {
        updates.push({ path: slot.path, value: only.value });
      }
    }

    const visible = visiblePaths(view.slots);
    const clearing = this.behavior.hidden === "empty-if-seen";
    const cleared = new Set<string>();
    // - one pass, one key per slot (hot path); a visible twin is caught by `visible`
    for (const slot of view.slots) {
      // - form-level paths contain no row index: their key is the path
      const key = slot.scope ? keyOf(slot.path) : slot.path;
      if (slot.visible) {
        if (slot.active) this.seen.add(key);
        continue;
      }
      if (!clearing || slot.fixed || visible.has(slot.path) || !this.seen.has(key) || cleared.has(slot.path)) continue;
      cleared.add(slot.path);
      this.seen.delete(key);
      const empty = emptyValueOf(slot.path, slot.def, this.kinds, this.schema);
      if (!Object.is(getPath(values, slot.path), empty)) updates.push({ path: slot.path, value: empty });
    }
    return updates;
  }

  /**
   * Values as they go to validation and the action.
   * - `"omit"`: hidden fields are removed (unless visible elsewhere or fixed).
   */
  prepare<T>(view: View, values: T): T {
    if (this.behavior.hidden !== "omit") return values;
    const visible = visiblePaths(view.slots);
    let result = values;
    for (const slot of view.slots) {
      if (!slot.visible && !slot.fixed && !visible.has(slot.path)) result = unsetPath(result, slot.path);
    }
    return result;
  }
}

/** Paths visible in at least one slot (a read-only twin keeps a hidden input's value). */
function visiblePaths(slots: readonly Slot[]): Set<string> {
  return new Set(slots.flatMap((s) => (s.visible ? [s.path] : [])));
}
