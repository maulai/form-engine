import type { Args, Dyn, DynContent, Tone } from "./args";
import { entries, type Entry, type FieldMap } from "./factory";
import type { Path, PathValue } from "./path";

/** Section or panel condition: a path that must be present, or a predicate. */
export type When<T, A> = Path<T> | ((args: A) => boolean);

export interface Section<T, A> {
  readonly name?: Dyn<string | undefined, A>;
  readonly description?: Dyn<string | undefined, A>;
  readonly if?: When<T, A>;
  readonly fields: FieldMap<T>;
  /** Content above / below the fields (notes, totals, previews). */
  readonly before?: DynContent<A>;
  readonly after?: DynContent<A>;
}

/** State of a panel, shown next to its navigation entry. */
export type PanelStatus =
  | "complete"
  | "incomplete"
  | "empty"
  | { readonly state: "complete" | "incomplete" | "empty"; readonly hint?: string; readonly tone?: Tone };

/** A page of a large form; panels turn the sidebar into navigation. */
export interface Panel<T, A> {
  readonly name: string;
  readonly if?: When<T, A>;
  readonly status?: (args: A) => PanelStatus | undefined;
  readonly sections: readonly Section<T, A>[];
}

export type Size = "sm" | "md" | "lg" | "xl";

export interface SubmitSpec<A> {
  readonly label?: Dyn<string | undefined, A>;
  /** Kit-specific icon, opaque to the engine. */
  readonly icon?: unknown;
  readonly destructive?: boolean;
}

/** Deep partial for defaults: anything not given comes from the schema's empty values. */
export type DeepPartial<T> = T extends readonly (infer E)[]
  ? readonly DeepPartial<E>[]
  : T extends Date | Blob | ((...args: never[]) => unknown)
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

/** Values on open. `value` is the record when editing, `undefined` when creating. */
export type DefaultsFn<V, T, C, P> = (value: V | undefined, args: { readonly ctx: C; readonly props: P }) => DeepPartial<T>;

/** Map validated values to the action input; `null`/`undefined` cancels the submit. */
export type ToInputFn<O, I, T, C, P> = (data: O, args: Args<T, C, P>) => I | null | undefined;

/**
 * How this form answers a server's request to confirm (the error adapter reports it).
 * - `retry`: the validated values for the second attempt, e.g. with the form's override flag set;
 *   they go through `toInput` again.
 * - Without `confirm` in the spec, a confirm request shows as an ordinary error.
 */
/**
 * A form-level reaction: when the user changes a value at one of `on` (or below it), `run`.
 * - `set` writes absolute paths; the write itself is not a user change (no effects cascade).
 */
export interface EffectSpec<T, A> {
  readonly on: readonly Path<T>[];
  readonly run: (tools: A & { readonly set: <K extends Path<T>>(path: K, value: PathValue<T, K>) => void }) => void | Promise<void>;
}

export interface ConfirmSpec<O, A> {
  readonly retry: (data: O, args: A) => O;
  readonly title?: Dyn<string | undefined, A>;
  /** Label of the confirm button. */
  readonly action?: Dyn<string | undefined, A>;
}

/**
 * Everything of a spec except `defaults` and `toInput`.
 * - Those two are captured separately by `define`: they carry the record and input types.
 */
interface SpecCore<T, C, P, O = unknown> {
  readonly title?: Dyn<string | undefined, Args<T, C, P>>;
  readonly description?: Dyn<string | undefined, Args<T, C, P>>;
  /** Overrides the size the kit derives from the content. */
  readonly size?: Size;
  readonly submit?: SubmitSpec<Args<T, C, P>>;
  /** Save on change instead of a submit button; number = debounce in ms. */
  readonly autosave?: boolean | number;
  /** After a successful submit: close a dialog (default), reset to defaults, or keep. */
  readonly afterSubmit?: "close" | "reset" | "keep";
  readonly confirm?: ConfirmSpec<O, Args<T, C, P>>;
  /**
   * Reactions to user changes at any of `on` (or below them): recompute one value from others.
   * - Run after the changed field's own `onChange`; never on open or programmatic sets.
   */
  readonly effects?: readonly EffectSpec<T, Args<T, C, P>>[];
}

/** Spec without `defaults`/`toInput`: either sections or panels. */
export type SpecLayout<T, C, P, O = unknown> = SpecCore<T, C, P, O> &
  (
    | { readonly sections: readonly Section<T, Args<T, C, P>>[]; readonly panels?: never }
    | { readonly panels: readonly Panel<T, Args<T, C, P>>[]; readonly sections?: never }
  );

/**
 * A complete spec.
 * - `T`: values (schema input), `O`: validated output, `V`: record being edited,
 *   `I`: what the action receives (default `O`), `C`/`P`: context and props
 */
export type FormSpec<T, O, V, I, C, P> = SpecLayout<T, C, P, O> & {
  readonly defaults?: DefaultsFn<V, T, C, P>;
  readonly toInput?: ToInputFn<O, I, T, C, P>;
};

// ── normalized (runtime) ─────────────────────────────────────────────────────

export interface SectionData {
  readonly name?: Dyn<string, never>;
  readonly description?: Dyn<string, never>;
  readonly if?: string | ((args: never) => boolean);
  readonly fields: readonly Entry[];
  readonly before?: DynContent<never>;
  readonly after?: DynContent<never>;
}

export interface PanelData {
  readonly name: string;
  readonly if?: string | ((args: never) => boolean);
  readonly status?: (args: never) => PanelStatus | undefined;
  readonly sections: readonly SectionData[];
}

/** The spec as the runtime reads it: always panels (a form without panels has one). */
export interface SpecData extends SpecCore<never, never, never, never> {
  readonly defaults?: DefaultsFn<never, never, never, never>;
  readonly toInput?: ToInputFn<never, unknown, never, never, never>;
  readonly panels: readonly PanelData[];
  /** - `false` when the author wrote `sections`: no navigation is rendered */
  readonly navigation: boolean;
}

type AnySection = { name?: unknown; description?: unknown; if?: unknown; fields: object };

function section(s: AnySection): SectionData {
  return { ...(s as Omit<SectionData, "fields">), fields: entries(s.fields as never) };
}

/** Normalize an authored spec. */
export function normalize(spec: FormSpec<never, never, never, never, never, never>): SpecData {
  const { sections, panels, ...rest } = spec as unknown as {
    sections?: AnySection[];
    panels?: (Omit<PanelData, "sections"> & { sections: AnySection[] })[];
  };
  if (panels) return { ...rest, navigation: true, panels: panels.map((p) => ({ ...p, sections: p.sections.map(section) })) };
  return { ...rest, navigation: false, panels: [{ name: "", sections: (sections ?? []).map(section) }] };
}

/**
 * Values when a form opens.
 * - `defaults(value, …)` when given, else the record itself, else `{}`.
 * - Fixed values are applied afterwards by the session.
 */
export function initialValues(spec: SpecData, input: { value?: unknown; ctx?: unknown; props?: unknown }): unknown {
  if (spec.defaults) {
    return (spec.defaults as unknown as (value: unknown, args: { ctx: unknown; props: unknown }) => unknown)(input.value, {
      ctx: input.ctx,
      props: input.props,
    });
  }
  return input.value ?? {};
}
