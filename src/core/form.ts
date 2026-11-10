import { createFactory, type Factory } from "./factory";
import type { Kinds } from "./kind";
import type { StandardSchemaV1 } from "./schema";
import { normalize, type DeepPartial, type DefaultsFn, type SpecData, type SpecLayout, type ToInputFn } from "./spec";

type In<S extends StandardSchemaV1> = StandardSchemaV1.InferInput<S>;
type Out<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

/**
 * Context hook: runs inside the engine on every render of the form, may call hooks.
 * - Return `undefined` while data is loading: the form shows placeholders and opens once it is there.
 */
export type ContextHook<P, C> = (args: { readonly props: P }) => C | undefined;

/**
 * A defined form, ready for a binding (`/react`) to render.
 * - Type parameters carry what the call site needs: record, action input, props.
 */
export interface FormDefinition<T, O, V, I, C, P> {
  readonly schema: StandardSchemaV1<T, O>;
  readonly spec: SpecData;
  readonly context?: ContextHook<P, C>;
  /** - phantom carrier for bindings, never set at runtime */
  readonly "~types"?: { values: T; output: O; value: V; input: I; ctx: C; props: P };
}

/**
 * What `form()` returns, as a type-level function of the definition.
 * - Core: the definition itself. Bindings plug in their own result (`/react`: a component).
 * - `this`-based higher-kinded type: `Wrapped<W, Def>` reads `out` with `def` set to `Def`.
 */
export interface Wrap {
  readonly def: unknown;
  readonly out: unknown;
}
export interface DefinitionWrap extends Wrap {
  readonly out: this["def"];
}
export type Wrapped<W extends Wrap, Def> = (W & { readonly def: Def })["out"];

// - the two captured slots; `any` marks "not written" (see ValueOf / InputOf)
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyDefaults<T, C, P> = DefaultsFn<any, NoInfer<T>, C, P>;
type AnyToInput<T, O, C, P> = ToInputFn<NoInfer<O>, any, NoInfer<T>, C, P>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Spec as authored: layout plus the two captured slots. */
// - naked type parameters: their constraint types unannotated parameters, they capture the function
type Authored<T, O, C, P, D, X> = SpecLayout<T, C, P, NoInfer<O>> & { readonly defaults?: D; readonly toInput?: X };

type IsAny<X> = 0 extends 1 & X ? true : false;

/** Record type: the annotated first parameter of `defaults`, else partial values. */
type ValueOf<D, T> = D extends (value: infer V, ...rest: never[]) => unknown
  ? IsAny<V> extends true
    ? DeepPartial<T>
    : unknown extends V
      ? DeepPartial<T>
      : Exclude<V, undefined>
  : DeepPartial<T>;

/** Action input: what `toInput` returns, else the validated output. */
type InputOf<X, O> = X extends (...args: never[]) => infer I ? (IsAny<I> extends true ? O : Exclude<I, null | undefined>) : O;

/**
 * Typing pattern for every `define`:
 * - `defaults` and `toInput` are captured as type parameters: they yield record and input type
 *   and keep literal return types (inferring them through the spec would widen literals)
 * - everything else is checked against the spec directly (contextual types, unknown keys)
 */
type Define<K extends Kinds, T, O, C, P, W extends Wrap> = <
  // - constraint without `| undefined`: a union here would drop the contextual types
  D extends AnyDefaults<T, C, P> = AnyDefaults<T, C, P>,
  X extends AnyToInput<T, O, C, P> = AnyToInput<T, O, C, P>,
>(
  define: (f: Factory<K, T, C, P>) => Authored<T, O, C, P, D, X>,
) => Wrapped<W, FormDefinition<T, O, ValueOf<D, T>, InputOf<X, O>, C, P>>;

/**
 * Chain for forms that need typed props or a context hook.
 * - Needed so `f` knows their types before the spec is written.
 */
export interface FormChain<K extends Kinds, T, O, C, P, W extends Wrap = DefinitionWrap> {
  /** Declare the form's own call-site props. */
  props<NewP extends object>(): FormChain<K, T, O, C, NewP, W>;
  /** Provide context from hooks (master data, permissions, …). */
  context<NewC>(hook: ContextHook<P, NewC>): FormChain<K, T, O, NewC, P, W>;
  /** Write the spec. */
  define: Define<K, T, O, C, P, W>;
}

export interface FormFn<K extends Kinds, W extends Wrap = DefinitionWrap> {
  /** Short form: no props, no context. */
  <
    S extends StandardSchemaV1,
    D extends AnyDefaults<In<S>, undefined, {}> = AnyDefaults<In<S>, undefined, {}>,
    X extends AnyToInput<In<S>, Out<S>, undefined, {}> = AnyToInput<In<S>, Out<S>, undefined, {}>,
  >(
    schema: S,
    define: (f: Factory<K, In<NoInfer<S>>, undefined, {}>) => Authored<In<NoInfer<S>>, Out<NoInfer<S>>, undefined, {}, D, X>,
  ): Wrapped<W, FormDefinition<In<S>, Out<S>, ValueOf<D, In<S>>, InputOf<X, Out<S>>, undefined, {}>>;
  /** Chain: `.props<P>()`, `.context(hook)`, then `.define(f => …)`. */
  <S extends StandardSchemaV1>(schema: S): FormChain<K, In<S>, Out<S>, undefined, {}, W>;
}

/**
 * Create the `form` function for a set of kinds.
 * - Bindings pass `wrap` to turn each definition into their result (`W` types it).
 * - Apps usually get `form` from their kit.
 */
export function createForm<K extends Kinds, W extends Wrap = DefinitionWrap>(
  kinds: K,
  wrap: (definition: FormDefinition<unknown, unknown, unknown, unknown, unknown, unknown>) => unknown = (d) => d,
): FormFn<K, W> {
  const factory = createFactory(kinds);

  const build = (schema: StandardSchemaV1, define: (f: never) => unknown, context?: ContextHook<never, unknown>) =>
    wrap({
      schema,
      spec: normalize(define(factory as never) as never),
      ...(context && { context: context as ContextHook<unknown, unknown> }),
    });

  const chain = (schema: StandardSchemaV1, context?: ContextHook<never, unknown>): FormChain<K, never, never, never, never> => ({
    props: () => chain(schema, context) as never,
    context: (hook) => chain(schema, hook as ContextHook<never, unknown>) as never,
    define: ((define: (f: never) => unknown) => build(schema, define, context)) as never,
  });

  return ((schema: StandardSchemaV1, define?: (f: never) => unknown) =>
    define ? build(schema, define) : chain(schema)) as unknown as FormFn<K, W>;
}
