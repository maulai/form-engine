import { useState, type ReactElement } from "react";
import type { FormComponent, FormProps } from "./form-component";

type TypesOf<Def> = NonNullable<Def extends { readonly "~types"?: infer X } ? X : never>;
type ValueOf<Def> = TypesOf<Def> extends { value: infer V } ? V : never;

/** Props fixed when the hook is called; the rest comes with `open(...)`. */
export type DialogFormProps<Def, R> = Omit<FormProps<Def, R>, "value" | "open" | "onOpenChange" | "trigger" | "inline">;

export interface FormDialog<Def, R> {
  /** Open for a record (edit) or without one (create); `props` override the hook's props for this open. */
  readonly open: (value?: ValueOf<Def>, props?: Partial<DialogFormProps<Def, R>>) => void;
  readonly close: () => void;
  /** Render it once, anywhere (e.g. below the table). */
  readonly element: ReactElement | null;
}

/**
 * One dialog for many records (table rows, cards).
 * - Mounts the form on open and unmounts it on close: every open is a fresh form.
 *
 * @example
 *   const edit = useFormDialog(TagForm, { action: (v) => updateTag(v) });
 *   rows.map((tag) => <button onClick={() => edit.open(tag)}>Edit</button>);
 *   {edit.element}
 */
export function useFormDialog<Def, R = unknown>(Form: FormComponent<Def>, props: DialogFormProps<Def, R>): FormDialog<Def, R> {
  const [current, setCurrent] = useState<{ value?: ValueOf<Def>; props?: Partial<DialogFormProps<Def, R>> } | null>(null);
  const close = () => setCurrent(null);
  const Component = Form as unknown as (p: Record<string, unknown>) => ReactElement;
  const element = current ? (
    <Component
      {...(props as object)}
      {...(current.props as object)}
      {...(current.value !== undefined && { value: current.value })}
      open
      onOpenChange={(open: boolean) => !open && close()}
    />
  ) : null;
  return { open: (value, extra) => setCurrent({ ...(value !== undefined && { value }), ...(extra && { props: extra }) }), close, element };
}
