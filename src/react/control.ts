import { useEffect } from "react";
import type { FieldProps } from "./types";

/** What every control needs from `FieldProps`, ready to spread. */
export interface ControlProps {
  readonly id: string;
  readonly onBlur: () => void;
  readonly readOnly: boolean;
  readonly placeholder?: string;
  readonly "aria-invalid"?: true;
}

/**
 * The wiring every control needs, in one spread: `<Input {...controlProps(props)} value=… onChange=… />`.
 * - `id`: labels and focus-on-error rely on it
 * - `onBlur`: validation after the first submit runs on blur
 * - `readOnly`, `aria-invalid`, `placeholder`
 * - `value` / `onChange` stay explicit: their shape differs per control
 */
export function controlProps(props: Pick<FieldProps<unknown>, "id" | "onBlur" | "readOnly" | "placeholder" | "invalid">): ControlProps {
  return {
    id: props.id,
    onBlur: props.onBlur,
    readOnly: props.readOnly,
    ...(props.placeholder !== undefined && { placeholder: props.placeholder }),
    ...(props.invalid && { "aria-invalid": true as const }),
  };
}

// - one check per kind and page: cheap, and one warning is enough
const checked = new Set<string>();

/** Test hook: forget which kinds were checked. */
export function resetKindChecks(): void {
  checked.clear();
}

/**
 * Warn once when a kind renders no element with the `id` it was given.
 * - Without it the label is not linked and focus-on-error cannot reach the field.
 * - Runs in every build: a broken kit is a bug in production too, and it costs one lookup per kind.
 */
export function useKindCheck(kind: string, id: string): void {
  useEffect(() => {
    if (checked.has(kind) || typeof document === "undefined") return;
    checked.add(kind);
    if (!document.getElementById(id)) {
      console.warn(
        `form-engine: kind "${kind}" renders no element with props.id ("${id}"). ` +
          "Labels are not linked and focus-on-error cannot reach it; spread controlProps(props) onto the control.",
      );
    }
  }, [kind, id]);
}
