import type { Entry } from "./factory";
import type { FieldDef } from "./field";
import type { Kind, Kinds } from "./kind";
import { getPath } from "./path";

/**
 * `.unique()` in a list: each value at most once across the rows.
 * - Needs a kind that lists its `options`; narrowing the UI also needs `withOptions`.
 */

/** Static config with `.config(fn)` applied for some row arguments. */
export function configFor(def: FieldDef, args: unknown): unknown {
  if (!def.dynamicConfig) return def.config;
  return { ...(def.config as object | undefined), ...(def.dynamicConfig as (a: unknown) => object)(args) };
}

/** Config of one row's field with the values other rows use removed (the row's own value stays). */
export function narrowUnique(kind: Kind | undefined, config: unknown, own: unknown, used: readonly unknown[]): unknown {
  if (!kind?.options || !kind.withOptions) return config;
  const allowed = kind.options(config as never).filter((v) => Object.is(v, own) || !used.some((u) => Object.is(u, v)));
  return kind.withOptions(config as never, allowed);
}

/**
 * Values for the unique columns of a new row: the first option no row uses yet.
 * - `null`: some unique column has no free option left, the list cannot grow.
 * - Columns hidden for the new row (their `.if` fails) do not count.
 */
export function freeValues(
  columns: readonly Entry[],
  kinds: Kinds,
  list: readonly unknown[],
  listArgs: object,
  visible: (def: FieldDef, row: unknown, args: unknown) => boolean,
): Record<string, unknown> | null {
  const free: Record<string, unknown> = {};
  const row = {};
  const args = { ...listArgs, row, index: list.length };
  for (const column of columns) {
    if (!column.def.unique) continue;
    const kind = kinds[column.def.kind];
    if (!kind?.options || !visible(column.def, row, args)) continue;
    const used = list.map((r) => getPath(r, column.key));
    const value = kind.options(configFor(column.def, args) as never).find((v) => !used.some((u) => Object.is(u, v)));
    if (value === undefined) return null;
    free[column.key] = value;
  }
  return free;
}
