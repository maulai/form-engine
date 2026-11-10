import type { ComponentType } from "react";
import type { FieldProps, ReactKind, ReadProps } from "./types";

export interface ReactKindOptions<V, Config> {
  /** Empty value: used for missing values and when a hidden field is cleared. */
  readonly empty?: V;
  /** Read view when the field is read-only (e.g. a name instead of a select). */
  readonly read?: ComponentType<ReadProps<V, Config>>;
  /** The component renders its label itself (checkbox, switch): `FieldFrame` gets none. */
  readonly labelInside?: boolean;
  /** Values a choice offers: with exactly one, the engine selects it and shows it read-only. */
  readonly options?: (config: Config) => readonly unknown[];
  /** The config with only `values` left as options; lets `.unique()` narrow the choice. */
  readonly withOptions?: (config: Config, values: readonly unknown[]) => Config;
}

/**
 * Register a component as a kind.
 * - Value and config types come from the component's `FieldProps<V, Config>`.
 * - With `setup`, the builder takes extra arguments after the label.
 *
 * @example
 *   text: kind(TextField, { empty: "" })                          // f.text("Name")
 *   select: kind(SelectField, (options: Options) => ({ options })) // f.select("Status", options)
 */
// - `NoInfer` on options: the value type comes from the component only (`empty: null` must not narrow it)
export function kind<V, Config = undefined>(
  component: ComponentType<FieldProps<V, Config>>,
  options?: ReactKindOptions<NoInfer<V>, NoInfer<Config>>,
): ReactKind<V, [], Config>;
export function kind<V, Params extends unknown[], Config>(
  component: ComponentType<FieldProps<V, Config>>,
  setup: (...params: Params) => NoInfer<Config>,
  options?: ReactKindOptions<NoInfer<V>, NoInfer<Config>>,
): ReactKind<V, Params, Config>;
export function kind(
  component: ComponentType<FieldProps<unknown, unknown>>,
  setupOrOptions?: ((...params: unknown[]) => unknown) | ReactKindOptions<unknown, unknown>,
  options?: ReactKindOptions<unknown, unknown>,
): ReactKind {
  const setup = typeof setupOrOptions === "function" ? setupOrOptions : undefined;
  const rest = typeof setupOrOptions === "function" ? options : setupOrOptions;
  return { render: component, ...(setup && { setup }), ...rest };
}
