import { createForm, type FormFn, type Wrap } from "../core";
import { createFormComponent, type FormComponent } from "./form-component";
import { defaultMessages, type Kit, type KitOptions, type ReactKinds } from "./types";

/** `form(...)` in React returns a component. */
export interface ReactWrap extends Wrap {
  readonly out: FormComponent<this["def"]>;
}

/**
 * Create the app's kit: kinds, layout, texts, adapters and behaviour, once per app.
 * - Returns `form`, the only function forms are written with.
 *
 * @example
 *   export const { form } = createFormKit({ kinds: { text: kind(TextField, { empty: "" }) }, layout });
 */
export function createFormKit<K extends ReactKinds>(options: KitOptions<K>): { form: FormFn<K, ReactWrap>; kit: Kit } {
  const kit: Kit = { ...options, messages: { ...defaultMessages, ...options.messages } };
  const form = createForm<K, ReactWrap>(options.kinds, (definition) => createFormComponent(definition as never, kit));
  return { form, kit };
}
