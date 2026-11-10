import { equal } from "./equal";
import { getPath, setPath } from "./path";
import type { FieldErrors } from "./schema";

/** Snapshot of a store; a new object on every change (safe for `useSyncExternalStore`). */
export interface StoreState<T> {
  readonly values: T;
  /** Values the form opened with; `dirty` compares against them. */
  readonly initial: T;
  /** Errors currently shown, by dot path. */
  readonly errors: FieldErrors;
  /** Paths the user has left at least once. */
  readonly touched: ReadonlySet<string>;
  /** A submit was attempted since the last reset. */
  readonly submitted: boolean;
}

export interface FormStore<T> {
  getState(): StoreState<T>;
  /** Called after every change (once per batch). */
  subscribe(listener: () => void): () => void;
  get(path: string): unknown;
  /** Write a value; `""` replaces all values. */
  set(path: string, value: unknown): void;
  /** Start over: new initial values, no errors, nothing touched, new row keys. */
  reset(values: T): void;
  touch(path: string): void;
  /**
   * Replace errors.
   * - Without `scope`: all errors.
   * - With `scope`: only errors at and below that path, others stay.
   */
  setErrors(errors: FieldErrors, scope?: string): void;
  markSubmitted(): void;
  /** Group changes into one notification. */
  batch(fn: () => void): void;
  /** Whether values differ from the initial ones, overall or at a path. */
  isDirty(path?: string): boolean;
  readonly rows: RowOps;
  /**
   * Path with row indexes replaced by row keys (`items.2.qty` → `items.#k7.qty`).
   * - Stable while rows are added, removed or moved.
   */
  keyedPath(path: string): string;
}

/**
 * List operations that keep row identity.
 * - Errors, touched state and nested row keys move with their row.
 */
export interface RowOps {
  /** Stable keys of the rows at `path` (one per row, in order). */
  keys(path: string): readonly string[];
  insert(path: string, index: number, row: unknown): void;
  append(path: string, row: unknown): void;
  remove(path: string, index: number): void;
  move(path: string, from: number, to: number): void;
}

/** Map the row index right after `list` in `path`; `undefined` drops the path. */
function reindex(path: string, list: string, map: (index: number) => number | undefined): string | undefined {
  if (!path.startsWith(`${list}.`)) return path;
  const rest = path.slice(list.length + 1);
  const dot = rest.indexOf(".");
  const head = dot < 0 ? rest : rest.slice(0, dot);
  if (!/^\d+$/.test(head)) return path;
  const next = map(Number(head));
  if (next === undefined) return undefined;
  return `${list}.${next}${dot < 0 ? "" : rest.slice(dot)}`;
}

/**
 * The form store: values, errors, touched, row keys.
 * - Framework-free; bindings subscribe and select what they render.
 * - Immutable values: every write copies along the path, so selectors compare by reference.
 */
export function createStore<T>(initialValues: T): FormStore<T> {
  let state: StoreState<T> = { values: initialValues, initial: initialValues, errors: {}, touched: new Set(), submitted: false };
  const listeners = new Set<() => void>();
  let depth = 0;
  let changed = false;
  let keyCounter = 0;
  // - row keys per list path; created lazily, reconciled when the list length changes
  let rowKeys = new Map<string, string[]>();
  // - keys per list for the current values state (`keyedPath` cache); row ops change values, so it renews
  let listCache: { values: unknown; keys: Map<string, readonly string[] | null> } = { values: undefined, keys: new Map() };

  const notify = () => {
    if (depth > 0) {
      changed = true;
      return;
    }
    for (const l of [...listeners]) l();
  };

  const update = (patch: Partial<StoreState<T>>) => {
    state = { ...state, ...patch };
    notify();
  };

  const batch = (fn: () => void) => {
    depth++;
    try {
      fn();
    } finally {
      depth--;
      if (depth === 0 && changed) {
        changed = false;
        notify();
      }
    }
  };

  const keys = (path: string): readonly string[] => {
    const list = getPath(state.values, path);
    const length = Array.isArray(list) ? list.length : 0;
    const known = rowKeys.get(path) ?? [];
    if (known.length === length) return known;
    const next = Array.from({ length }, (_, i) => known[i] ?? `#k${++keyCounter}`);
    rowKeys.set(path, next);
    return next;
  };

  /** Apply an index mapping to everything keyed by path below `list`. */
  const shift = (list: string, map: (index: number) => number | undefined) => {
    const errors: FieldErrors = {};
    for (const [p, m] of Object.entries(state.errors)) {
      const next = reindex(p, list, map);
      if (next !== undefined) errors[next] = m;
    }
    const touched = new Set<string>();
    for (const p of state.touched) {
      const next = reindex(p, list, map);
      if (next !== undefined) touched.add(next);
    }
    // - nested lists (`items.2.parts`) move with their row
    const nested = new Map<string, string[]>();
    for (const [p, k] of rowKeys) {
      const next = reindex(p, list, map);
      if (next !== undefined) nested.set(next, k);
    }
    rowKeys = nested;
    return { errors, touched };
  };

  const listOf = (path: string): unknown[] => {
    const list = getPath(state.values, path);
    return Array.isArray(list) ? [...list] : [];
  };

  const rows: RowOps = {
    keys,
    insert(path, index, row) {
      const list = listOf(path);
      const at = Math.max(0, Math.min(index, list.length));
      const k = [...keys(path)];
      list.splice(at, 0, row);
      k.splice(at, 0, `#k${++keyCounter}`);
      const moved = shift(path, (i) => (i >= at ? i + 1 : i));
      rowKeys.set(path, k);
      update({ values: setPath(state.values, path, list), ...moved });
    },
    append(path, row) {
      rows.insert(path, listOf(path).length, row);
    },
    remove(path, index) {
      const list = listOf(path);
      if (index < 0 || index >= list.length) return;
      const k = [...keys(path)];
      list.splice(index, 1);
      k.splice(index, 1);
      const moved = shift(path, (i) => (i === index ? undefined : i > index ? i - 1 : i));
      rowKeys.set(path, k);
      update({ values: setPath(state.values, path, list), ...moved });
    },
    move(path, from, to) {
      const list = listOf(path);
      if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
      const k = [...keys(path)];
      const order = list.map((_, i) => i);
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      const [key] = k.splice(from, 1);
      k.splice(to, 0, key!);
      const [index] = order.splice(from, 1);
      order.splice(to, 0, index!);
      // - `order[newIndex] = oldIndex`; invert for old → new
      const target = new Map(order.map((old, i) => [old, i]));
      const moved = shift(path, (i) => target.get(i));
      rowKeys.set(path, k);
      update({ values: setPath(state.values, path, list), ...moved });
    },
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: (path) => (path === "" ? state.values : getPath(state.values, path)),
    set(path, value) {
      const current = path === "" ? state.values : getPath(state.values, path);
      if (Object.is(current, value)) return;
      update({ values: path === "" ? (value as T) : setPath(state.values, path, value) });
    },
    reset(values) {
      rowKeys = new Map();
      state = { values, initial: values, errors: {}, touched: new Set(), submitted: false };
      notify();
    },
    touch(path) {
      if (state.touched.has(path)) return;
      update({ touched: new Set([...state.touched, path]) });
    },
    setErrors(errors, scope) {
      let next: FieldErrors = errors;
      if (scope !== undefined) {
        const inScope = (p: string) => p === scope || p.startsWith(`${scope}.`);
        next = Object.fromEntries(Object.entries(state.errors).filter(([p]) => !inScope(p)));
        for (const [p, m] of Object.entries(errors)) if (inScope(p)) next[p] = m;
      }
      if (equal(next, state.errors)) return;
      update({ errors: next });
    },
    markSubmitted() {
      if (!state.submitted) update({ submitted: true });
    },
    batch,
    isDirty: (path) =>
      path === undefined ? !equal(state.values, state.initial) : !equal(getPath(state.values, path), getPath(state.initial, path)),
    rows,
    keyedPath(path) {
      // - hot path (every slot on every change): one lookup per list and values state
      if (listCache.values !== state.values) listCache = { values: state.values, keys: new Map() };
      const segments = path.split(".");
      let prefix = "";
      let result = "";
      for (const segment of segments) {
        let out = segment;
        if (prefix && /^\d+$/.test(segment)) {
          let k = listCache.keys.get(prefix);
          if (k === undefined) {
            k = Array.isArray(getPath(state.values, prefix)) ? keys(prefix) : null;
            listCache.keys.set(prefix, k);
          }
          out = k?.[Number(segment)] ?? segment;
        }
        result = result ? `${result}.${out}` : out;
        prefix = prefix ? `${prefix}.${segment}` : segment;
      }
      return result;
    },
  };
}
