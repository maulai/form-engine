import type { FieldErrors } from "./schema";
import type { View } from "./view";

/**
 * A server-side rejection, as the error adapter reports it.
 * - `fields`: messages per dot path
 * - `message`: one message for the whole form
 * - `confirm`: the server asks to confirm; the engine shows a dialog and retries
 */
export interface ServerError {
  readonly message?: string;
  readonly fields?: FieldErrors;
  readonly confirm?: ConfirmRequest;
}

/**
 * The server asks to confirm.
 * - Usually only the message: how to retry is the form's business (`confirm.retry` in its spec).
 * - `retry` here is a fallback for kits whose API uses one override for every form.
 */
export interface ConfirmRequest {
  readonly message: string;
  readonly title?: string;
  /** Label of the confirm button. */
  readonly action?: string;
  /** Action input for the retry; used only when the form's spec has no `confirm`. */
  readonly retry?: (input: never) => unknown;
}

/**
 * Turns whatever an action throws into a `ServerError`.
 * - Return `null` when the error was handled (e.g. redirect to a login): nothing is shown.
 * - Throw to let the error escape the form.
 */
export type ErrorAdapter = (error: unknown) => ServerError | null;

/** Default: the error's message for the whole form. */
export const defaultErrorAdapter: ErrorAdapter = (error) => ({
  message: error instanceof Error ? error.message : String(error),
});

/** Errors split by where they can be shown. */
export interface RoutedErrors {
  /** Errors at a visible field, in the order of the form. */
  readonly placed: readonly { readonly path: string; readonly message: string }[];
  /** Errors without a visible field: shown in a summary, so a submit never fails silently. */
  readonly unplaced: readonly string[];
  /** Authored indexes of panels that contain an error. */
  readonly panels: ReadonlySet<number>;
}

/**
 * Route errors to visible fields.
 * - A field takes errors at its path and below it (a list takes its rows' errors
 *   unless a column shows them).
 * - The empty path (form-level schema issue) is always unplaced.
 */
export function routeErrors(errors: FieldErrors, view: View): RoutedErrors {
  const visible = view.slots.filter((s) => s.visible);
  const placed: { path: string; message: string }[] = [];
  const unplaced: string[] = [];
  const panels = new Set<number>();

  for (const [path, message] of Object.entries(errors)) {
    const owner =
      visible.find((s) => s.path === path) ??
      // - deepest visible ancestor, e.g. the list for `items.2` without a column
      [...visible].sort((a, b) => b.path.length - a.path.length).find((s) => path !== "" && path.startsWith(`${s.path}.`));
    if (owner) {
      placed.push({ path, message });
      panels.add(owner.panel);
    } else unplaced.push(message);
  }

  placed.sort((a, b) => rank(a.path, view) - rank(b.path, view));
  return { placed, unplaced, panels };
}

/**
 * Position of a path in the form.
 * - Exact slot: its index.
 * - Otherwise right after the last slot under its nearest ancestor (`items.0.qty`
 *   without a column sorts after the other columns of row 0).
 */
function rank(path: string, view: View): number {
  const exact = view.slots.findIndex((s) => s.path === path);
  if (exact >= 0) return exact;
  const segments = path.split(".");
  for (let n = segments.length - 1; n > 0; n--) {
    const prefix = segments.slice(0, n).join(".");
    let last = -1;
    view.slots.forEach((s, i) => {
      if (s.path === prefix || s.path.startsWith(`${prefix}.`)) last = i;
    });
    if (last >= 0) return last + 0.5;
  }
  return Infinity;
}
