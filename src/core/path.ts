/**
 * Typed dot paths into form values.
 * - Objects are descended, arrays and records are leaves (lists are handled by `rows`).
 * - Depth is capped to keep the compiler fast on large inputs.
 */

/** Values the engine never descends into. */
export type Leaf =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Date
  | Blob
  | ((...args: never[]) => unknown)
  | ReadonlyArray<unknown>;

/** Object with a string index signature (e.g. a map of translations). */
type IsRecord<T> = string extends keyof T ? true : false;

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7];

/** All dot paths of `T` that point at a value or a nested object. */
export type Path<T, D extends number = 7> = [D] extends [never]
  ? never
  : T extends Leaf
    ? never
    : IsRecord<T> extends true
      ? never
      : T extends object
        ? {
            [K in keyof T & string]-?:
              | K
              | (NonNullable<T[K]> extends Leaf
                  ? never
                  : IsRecord<NonNullable<T[K]>> extends true
                    ? never
                    : `${K}.${Path<NonNullable<T[K]>, Prev[D]>}`);
          }[keyof T & string]
        : never;

/** Type at a dot path. Optional parents are skipped (the leaf keeps its own nullability). */
export type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof NonNullable<T>
    ? PathValue<NonNullable<NonNullable<T>[K]>, Rest>
    : never
  : P extends keyof NonNullable<T>
    ? NonNullable<T>[P]
    : never;

/** Element type of an array path value. */
export type Element<V> = NonNullable<V> extends ReadonlyArray<infer E> ? E : never;

/** Paths whose value is a list of objects (candidates for `rows`). */
export type RowsPath<T> = {
  [P in Path<T>]: Element<PathValue<T, P>> extends object ? (Element<PathValue<T, P>> extends Leaf ? never : P) : never;
}[Path<T>];

// ── runtime ────────────────────────────────────────────────────────────────

/** Read a dot path; missing parents yield `undefined`. */
export function getPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Remove a dot path immutably.
 * - Missing parents leave the source as is.
 */
export function unsetPath<T>(source: T, path: string): T {
  const [key, ...rest] = path.split(".") as [string, ...string[]];
  if (source == null || typeof source !== "object" || !(key in source)) return source;
  const base = (Array.isArray(source) ? [...source] : { ...source }) as Record<string, unknown>;
  if (rest.length === 0) delete base[key];
  else base[key] = unsetPath(base[key], rest.join("."));
  return base as T;
}

/**
 * Whether a value counts as given for `.if(path)`.
 * - Falsy values, empty strings, empty lists and empty objects are absent.
 */
export function isPresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Date) return true;
  if (value !== null && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * Write a dot path immutably.
 * - Copies every object on the way, creates missing parents.
 * - Numeric segments on arrays copy the array.
 */
export function setPath<T>(source: T, path: string, value: unknown): T {
  const [key, ...rest] = path.split(".") as [string, ...string[]];
  const base: Record<string, unknown> | unknown[] =
    Array.isArray(source) ? [...source] : { ...(source as Record<string, unknown> | undefined) };
  const next = rest.length === 0 ? value : setPath((base as Record<string, unknown>)[key], rest.join("."), value);
  (base as Record<string, unknown>)[key] = next;
  return base as T;
}
