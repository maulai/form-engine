import { createContext, useContext } from "react";
import type { Controller } from "../core";
import type { Kit } from "./types";

export interface FormContextValue {
  readonly controller: Controller;
  readonly kit: Kit;
  /** DOM id of the input at a path (unique per form instance). */
  readonly idOf: (path: string) => string;
}

export interface FieldContextValue {
  readonly path: string;
  readonly id: string;
  readonly readOnly: boolean;
  /** Row of the field (`""` at form level), its index and the enclosing row (nested lists). */
  readonly scope: string;
  readonly index?: number;
  readonly parentScope?: string;
}

export const FormContext = createContext<FormContextValue | null>(null);
export const FieldContext = createContext<FieldContextValue | null>(null);

export function useFormContext(): FormContextValue {
  const value = useContext(FormContext);
  if (!value) throw new Error("form-engine: hook used outside of a form");
  return value;
}

/** The field being rendered, if any (hooks that also work outside fields). */
export function useOptionalFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

export function useFieldContext(): FieldContextValue {
  const value = useContext(FieldContext);
  if (!value) throw new Error("form-engine: useField() used outside of a field (f.custom or a kind)");
  return value;
}
