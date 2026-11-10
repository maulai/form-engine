/**
 * The one argument every dynamic property receives.
 * - `values`: current form values
 * - `ctx`: data from the form's context hook
 * - `props`: the form's own call-site props
 * - `edit`: the form was opened with an existing `value`
 */
export interface Args<T, C = unknown, P = unknown> {
  readonly values: T;
  readonly ctx: C;
  readonly props: P;
  readonly edit: boolean;
}

/**
 * Arguments inside a list: adds the current row and its index.
 * - `parent`: the enclosing row of a nested list (`items.2` for `items.2.parts.0`), else `undefined`
 */
export interface RowArgs<T, C, P, R, Parent = undefined> extends Args<T, C, P> {
  readonly row: R;
  readonly index: number;
  readonly parent: Parent;
}

/** The row of an argument type; becomes the `parent` of a list nested inside it. */
export type RowOf<A> = A extends { readonly row: infer R } ? R : undefined;

/** A property that is static or derived from the arguments. */
export type Dyn<R, A> = R | ((args: A) => R);

/**
 * Renderable content, opaque to the core (a React node in `/react`).
 * - Not `unknown`: `unknown | function` collapses and loses the parameter types.
 */
export type Content = string | number | boolean | null | undefined | object;

/** Content that is static or derived from the arguments. */
export type DynContent<A> = Content | ((args: A) => Content);

/** Resolve a static or derived property. */
export function resolve<R, A>(value: Dyn<R, A>, args: A): R {
  return typeof value === "function" ? (value as (args: A) => R)(args) : value;
}

/** Text under a field; a tone turns it into a warning or error-like note. */
export type Hint = string | { readonly text: string; readonly tone?: Tone; readonly tooltip?: string };

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
