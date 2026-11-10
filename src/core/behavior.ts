/**
 * The engine's opinions. A kit may change them once for the whole app; forms cannot.
 */
export interface Behavior {
  /**
   * What hiding a field does to its value:
   * - `"empty-if-seen"`: shown before, then hidden → set to its empty value; never shown → kept
   * - `"omit"`: hidden fields are removed from the submitted values
   * - `"keep"`: values stay untouched
   */
  readonly hidden: "empty-if-seen" | "omit" | "keep";
  /**
   * When fields are validated:
   * - `"submit-then-blur"`: first on submit, afterwards a field again when it is left
   * - `"change"`: on every change (always the case with autosave)
   */
  readonly validation: "submit-then-blur" | "change";
  /** A choice with exactly one option renders as text. */
  readonly collapseSingleOption: boolean;
  /** Focus and scroll to the first invalid field after a failed submit. */
  readonly focusFirstError: boolean;
  /** Ask before closing a dialog with unsaved changes. */
  readonly confirmDiscard: boolean;
  /** Autosave debounce in ms when a form sets `autosave: true`. */
  readonly autosaveDelay: number;
}

export const defaultBehavior: Behavior = {
  hidden: "empty-if-seen",
  validation: "submit-then-blur",
  collapseSingleOption: true,
  focusFirstError: true,
  confirmDiscard: true,
  autosaveDelay: 800,
};
