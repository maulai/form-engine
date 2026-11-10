/**
 * A field kind as registered by the kit (`text`, `select`, `money`, …).
 * - `V`: value the kind edits
 * - `Params`: extra builder arguments after the label (`f.select(label, options)`)
 * - `Config`: what `setup` turns those arguments into; handed to the renderer
 * - `render`: binding-specific renderer (a React component in `/react`), opaque to the core
 * - `empty`: the kind's empty value (used when a hidden field is cleared)
 */
export interface Kind<V = unknown, Params extends unknown[] = unknown[], Config = unknown> {
  readonly setup?: (...params: Params) => Config;
  readonly render?: unknown;
  readonly empty?: V;
  /**
   * The values a choice kind offers, from its config.
   * - With exactly one option (and `collapseSingleOption`), the engine selects it and shows it read-only.
   */
  readonly options?: (config: Config) => readonly unknown[];
  /** The config with only `values` left as options (used by `.unique()`). */
  readonly withOptions?: (config: Config, values: readonly unknown[]) => Config;
  /** - phantom carrier, never set at runtime */
  readonly "~types"?: { readonly value: V; readonly params: Params; readonly config: Config };
}

// - `any` keeps every concrete kind assignable regardless of variance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Kinds = Record<string, Kind<any, any, any>>;

/** Names the engine provides itself; a kit cannot override them. */
export const RESERVED_KINDS = ["when", "rows", "picker", "display", "note", "custom"] as const;
export type ReservedKind = (typeof RESERVED_KINDS)[number];

/** Engine kinds that show content but hold no value. */
export const CONTENT_KINDS: readonly string[] = ["display", "note"];

/** A kind without extra parameters that can still gain them via `.params(setup)`. */
export interface KindBuilder<V> extends Kind<V, [], undefined> {
  /** Extra builder arguments after the label, turned into the renderer's config. */
  params<Params extends unknown[], Config>(
    setup: (...params: Params) => Config,
    extra?: {
      readonly options?: (config: NoInfer<Config>) => readonly unknown[];
      readonly withOptions?: (config: NoInfer<Config>, values: readonly unknown[]) => NoInfer<Config>;
    },
  ): Kind<V, Params, Config>;
}

/** Options of a kind besides its parameters. */
export interface KindOptions<V> {
  readonly render?: unknown;
  readonly empty?: V;
}

/**
 * Declare a kind by its value type.
 * - Curried on purpose: `V` is explicit, params and config are inferred from `setup`.
 * - Bindings (`/react`) offer a variant that infers everything from a component.
 *
 * @example
 *   kind<string>({ empty: "" })                                     // f.text("Name")
 *   kind<string>().params((options: Options) => ({ options }))      // f.select("Status", options)
 */
export function kind<V>(options: KindOptions<V> = {}): KindBuilder<V> {
  return { ...options, params: (setup, extra) => ({ ...options, ...extra, setup }) };
}

/**
 * The single value a choice field offers, if it offers exactly one.
 * - `undefined` for kinds without `options` and for zero or several options.
 */
export function singleOption(kind: Kind | undefined, config: unknown): { readonly value: unknown } | undefined {
  const values = kind?.options?.(config as never);
  return values && values.length === 1 ? { value: values[0] } : undefined;
}
