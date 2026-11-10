import { useCallback, useRef, useSyncExternalStore } from "react";
import { equal, getPath, type ControllerState, type StoreState } from "../core";
import { useFieldContext, useFormContext, useOptionalFieldContext } from "./context";

/**
 * Subscribe to a selection of an external source.
 * - Re-renders only when the selection changes (`isEqual`, default `Object.is`).
 * - Caches per snapshot and selector: selectors may build new objects without render loops.
 * - The selector is part of the cache key: a field whose path changed (row moved up)
 *   must never get the result computed for its old path.
 */
export function useSelector<S, R>(
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => S,
  select: (snapshot: S) => R,
  isEqual: (a: R, b: R) => boolean = Object.is,
): R {
  const cache = useRef<{ snapshot: S; select: (snapshot: S) => R; result: R } | null>(null);
  const read = () => {
    const snapshot = getSnapshot();
    const last = cache.current;
    if (last && Object.is(last.snapshot, snapshot) && last.select === select) return last.result;
    const result = select(snapshot);
    if (last && isEqual(last.result, result)) {
      cache.current = { snapshot, select, result: last.result };
      return last.result;
    }
    cache.current = { snapshot, select, result };
    return result;
  };
  return useSyncExternalStore(subscribe, read, read);
}

// ── internal ───────────────────────────────────────────────────────────────

export function useStore<R>(select: (state: StoreState<unknown>) => R, isEqual?: (a: R, b: R) => boolean): R {
  const { controller } = useFormContext();
  const { store } = controller;
  return useSelector(store.subscribe, store.getState, select, isEqual);
}

export function useControllerState<R>(select: (state: ControllerState) => R, isEqual?: (a: R, b: R) => boolean): R {
  const { controller } = useFormContext();
  return useSelector(controller.subscribe, controller.getState, select, isEqual);
}

// ── public ─────────────────────────────────────────────────────────────────

/** The field a custom component renders (inside `f.custom(...)` or a kind). */
export interface FieldApi<V> {
  readonly path: string;
  readonly id: string;
  readonly value: V;
  /** A user change: effects, validation timing and autosave apply. */
  readonly set: (value: V) => void;
  readonly blur: () => void;
  readonly error?: string;
  readonly readOnly: boolean;
}

export function useField<V = unknown>(): FieldApi<V> {
  const { controller } = useFormContext();
  const { path, id, readOnly } = useFieldContext();
  const value = useStore((s) => getPath(s.values, path)) as V;
  const error = useStore((s) => s.errors[path]);
  const set = useCallback((next: V) => controller.change(path, next), [controller, path]);
  const blur = useCallback(() => controller.blur(path), [controller, path]);
  return { path, id, value, set, blur, readOnly, ...(error !== undefined && { error }) };
}

/**
 * Arguments of the field being rendered, as dynamic properties get them.
 * - Inside a list: `row`, `index`, and `parent` (enclosing row) in nested lists.
 * - Outside a field: the form-level arguments.
 */
export interface FieldArgs {
  readonly values: unknown;
  readonly ctx: unknown;
  readonly props: unknown;
  readonly edit: boolean;
  readonly row?: unknown;
  readonly index?: number;
  readonly parent?: unknown;
}

/**
 * The arguments of the current field (kinds, `f.custom`).
 * - Without `select`: re-renders on every change of the form. With `select`: only when the
 *   selection changes (structurally) — prefer it in lists.
 *
 * @example
 *   const product = useArgs(({ row, props }) => props.products.find((p) => p.id === row.product_id));
 */
export function useArgs<A extends FieldArgs = FieldArgs>(): A;
export function useArgs<A extends FieldArgs, R>(select: (args: A) => R): R;
export function useArgs(select?: (args: FieldArgs) => unknown): unknown {
  const { controller } = useFormContext();
  const field = useOptionalFieldContext();
  const build = (): FieldArgs => {
    const base = controller.args();
    if (!field?.scope) return base;
    const { values } = base;
    return {
      ...base,
      row: getPath(values, field.scope),
      ...(field.index !== undefined && { index: field.index }),
      ...(field.parentScope !== undefined && { parent: getPath(values, field.parentScope) }),
    };
  };
  // - the controller publishes after every store and context change
  return useSelector(controller.subscribe, controller.getState, () => (select ? select(build()) : build()), select ? equal : Object.is);
}

/** A selection of the form values; re-renders when the selection changes (structurally). */
export function useValues<R>(select: (values: unknown) => R): R {
  return useStore((s) => select(s.values), equal);
}

/** A list with stable row keys and user operations. */
export interface RowsApi<Row> {
  readonly keys: readonly string[];
  readonly rows: readonly Row[];
  readonly append: (row: Row) => void;
  readonly insert: (index: number, row: Row) => void;
  readonly remove: (index: number) => void;
  readonly move: (from: number, to: number) => void;
}

export function useRows<Row = unknown>(path: string): RowsApi<Row> {
  const { controller } = useFormContext();
  const rows = useStore((s) => {
    const list = getPath(s.values, path);
    return (Array.isArray(list) ? list : EMPTY) as readonly Row[];
  });
  // - keys are stable per list length; recomputed when rows change
  const keys = controller.store.rows.keys(path);
  return {
    keys,
    rows,
    append: (row) => controller.rows.append(path, row),
    insert: (index, row) => controller.rows.insert(path, index, row),
    remove: (index) => controller.rows.remove(path, index),
    move: (from, to) => controller.rows.move(path, from, to),
  };
}

const EMPTY: readonly never[] = [];

/** Imperative access for custom code (buttons that fill fields, pickers, …). */
export interface FormApi {
  readonly get: (path: string) => unknown;
  /** A user change at `path`. */
  readonly set: (path: string, value: unknown) => void;
  readonly submit: () => Promise<unknown>;
  readonly isDirty: () => boolean;
  /** Back to the values the form opened with. */
  readonly reset: () => void;
  /** Block submit (and hold autosave) while `work` runs: `await api.busy(upload(file))`. */
  readonly busy: <T>(work: Promise<T>) => Promise<T>;
}

export function useFormApi(): FormApi {
  const { controller } = useFormContext();
  return {
    get: controller.store.get,
    set: controller.change,
    submit: controller.submit,
    isDirty: () => controller.store.isDirty(),
    reset: controller.reset,
    busy: controller.busy,
  };
}
