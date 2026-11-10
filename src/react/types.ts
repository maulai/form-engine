import type { ComponentType, ReactNode } from "react";
import type { Behavior, ErrorAdapter, Kind, SchemaAdapter, Size, Tone } from "../core";

/** A hint as the kit renders it: always an object. */
export interface HintView {
  readonly text: string;
  readonly tone?: Tone;
  readonly tooltip?: string;
}

/** A panel state as the kit renders it: state and tone always set. */
export interface PanelStatusView {
  readonly state: "complete" | "incomplete" | "empty";
  readonly tone: Tone;
  readonly hint?: string;
}

// ── field components ───────────────────────────────────────────────────────

/**
 * Props of a field component in the kit.
 * - The component renders the input only; label, hint and error come from `FieldFrame`.
 * - `value` is never `undefined` when the kind declares `empty`.
 */
export interface FieldProps<V, Config = undefined> {
  /** Unique per form instance; use it as the input's `id` (labels and focus rely on it). */
  readonly id: string;
  readonly value: V;
  readonly onChange: (value: V) => void;
  readonly onBlur: () => void;
  /** Also passed to the input, for kinds that render their label inline (checkbox, switch). */
  readonly label?: string;
  readonly placeholder?: string;
  readonly readOnly: boolean;
  readonly invalid: boolean;
  readonly config: Config;
}

/** Read view of a kind (used when the field is read-only and the kind provides one). */
export interface ReadProps<V, Config = undefined> {
  readonly id: string;
  readonly value: V;
  readonly label?: string;
  readonly config: Config;
}

/** A kind as the React kit registers it. */
export interface ReactKind<V = unknown, Params extends unknown[] = unknown[], Config = unknown> extends Kind<V, Params, Config> {
  readonly render: ComponentType<FieldProps<V, Config>>;
  readonly read?: ComponentType<ReadProps<V, Config>>;
  /** The component renders its label itself (checkbox, switch): `FieldFrame` gets none. */
  readonly labelInside?: boolean;
}

// ── layout components ──────────────────────────────────────────────────────

export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly trigger?: ReactNode;
  readonly title?: string;
  readonly description?: string;
  readonly size: Size;
  /** Panel navigation; when set, render the sidebar layout. */
  readonly nav?: ReactNode;
  /** Left column without panels (a picker); render the sidebar layout with it. */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}

export interface InlineProps {
  readonly title?: string;
  readonly description?: string;
  readonly nav?: ReactNode;
  /** Left column without panels (a picker); render it like the navigation. */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}

export interface PanelNavProps {
  readonly panels: readonly {
    readonly index: number;
    readonly name: string;
    /** Normalised state; a panel with an error is `incomplete` / `danger` with the `panelInvalid` hint. */
    readonly status?: PanelStatusView;
    readonly active: boolean;
    /** The panel contains a field with an error. */
    readonly invalid: boolean;
  }[];
  readonly onSelect: (index: number) => void;
}

export interface SectionProps {
  readonly name?: string;
  readonly description?: string;
  readonly before?: ReactNode;
  readonly after?: ReactNode;
  /**
   * Field frames; lay them out in a grid, `wide` frames span the full width.
   * - How many columns is the kit's call (e.g. one in small dialogs, via a container query).
   */
  readonly children: ReactNode;
}

export interface FieldFrameProps {
  /** Id of the input; use it for `<label htmlFor>`. */
  readonly id: string;
  readonly kind: string;
  /** Where the field sits: in a section, or as a cell of a list (`as` = the list's presentation; `undefined` = kit default). */
  readonly place: "form" | "row";
  readonly as?: "table" | "cards" | "inline";
  readonly label?: string;
  readonly hint?: HintView;
  readonly error?: string;
  readonly required?: boolean;
  readonly wide: boolean;
  readonly readOnly: boolean;
  readonly children: ReactNode;
}

export interface RowsProps {
  readonly id: string;
  /** `as` from the spec; `undefined` = the kit's default. */
  readonly as?: "table" | "cards" | "inline";
  readonly label?: string;
  readonly hint?: HintView;
  /** Error of the list itself (e.g. "at least one"). */
  readonly error?: string;
  readonly wide: boolean;
  readonly readOnly: boolean;
  /** Column headers (static labels). */
  readonly columns: readonly { readonly key: string; readonly label?: string }[];
  readonly rows: readonly {
    /** Stable key; use it as React `key`. */
    readonly key: string;
    readonly index: number;
    /** One rendered cell per visible column (each a `FieldFrame`). */
    readonly cells: readonly { readonly key: string; readonly node: ReactNode }[];
    /** Errors of the row without a column. */
    readonly error?: string;
    readonly onRemove?: () => void;
  }[];
  readonly onAdd?: () => void;
  readonly addLabel: string;
  readonly empty?: string;
  /** Set when rows can be reordered. */
  readonly onMove?: (from: number, to: number) => void;
  /** Inline picker; render it above the rows. */
  readonly picker?: ReactNode;
  /** Content below the rows (totals). */
  readonly summary?: ReactNode;
}

export interface SubmitButtonProps {
  /** Id of the `<form>`; buttons outside the form element submit it via the `form` attribute. */
  readonly form: string;
  readonly label: string;
  readonly pending: boolean;
  /** A save just succeeded (shown for a moment). */
  readonly saved: boolean;
  readonly destructive: boolean;
  readonly icon?: unknown;
  /** The form cannot be submitted yet (data loading). */
  readonly disabled: boolean;
}

export interface SummaryProps {
  readonly messages: readonly string[];
}

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirm: string;
  readonly cancel: string;
  readonly destructive: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export interface PickerProps {
  readonly items: readonly {
    readonly key: string;
    readonly label: ReactNode;
    /** Text to search in. */
    readonly text: string;
    /** Already in the list (`unique`). */
    readonly disabled: boolean;
  }[];
  readonly onPick: (key: string) => void;
  readonly placement: "sidebar" | "inline";
  readonly placeholder?: string;
  readonly empty?: string;
  /** Entry that adds a row not taken from the items. */
  readonly custom?: { readonly label: string; readonly onAdd: () => void };
  /** Picking is not possible right now. */
  readonly disabled: boolean;
}

export interface AutosaveStatusProps {
  readonly pending: boolean;
  readonly saved: boolean;
}

/** Every visual block the engine needs; the kit maps them to its UI library. */
export interface Layout {
  readonly Dialog: ComponentType<DialogProps>;
  readonly Inline: ComponentType<InlineProps>;
  readonly PanelNav: ComponentType<PanelNavProps>;
  readonly Section: ComponentType<SectionProps>;
  readonly FieldFrame: ComponentType<FieldFrameProps>;
  readonly Rows: ComponentType<RowsProps>;
  readonly SubmitButton: ComponentType<SubmitButtonProps>;
  readonly Summary: ComponentType<SummaryProps>;
  readonly ConfirmDialog: ComponentType<ConfirmDialogProps>;
  readonly AutosaveStatus: ComponentType<AutosaveStatusProps>;
  readonly Picker: ComponentType<PickerProps>;
  /** Placeholder while the form's data loads. */
  readonly Loading: ComponentType<object>;
}

// ── texts ──────────────────────────────────────────────────────────────────

/** Every text the engine renders itself. */
export interface Messages {
  readonly submit: string;
  readonly add: string;
  readonly discardTitle: string;
  readonly discardMessage: string;
  readonly discardConfirm: string;
  readonly keepEditing: string;
  readonly confirmTitle: string;
  readonly confirmAction: string;
  /** Hint of a panel that contains an error. */
  readonly panelInvalid: string;
  readonly cancel: string;
}

export const defaultMessages: Messages = {
  submit: "Save",
  add: "Add",
  discardTitle: "Discard changes?",
  discardMessage: "Your changes have not been saved.",
  discardConfirm: "Discard",
  keepEditing: "Keep editing",
  confirmTitle: "Confirmation required",
  confirmAction: "Continue anyway",
  panelInvalid: "Check the highlighted fields",
  cancel: "Cancel",
};

// ── kit ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReactKinds = Record<string, ReactKind<any, any, any>>;

export interface KitOptions<K extends ReactKinds> {
  readonly kinds: K;
  readonly layout: Layout;
  readonly behavior?: Partial<Behavior>;
  readonly errors?: ErrorAdapter;
  readonly schema?: SchemaAdapter;
  readonly messages?: Partial<Messages>;
}

/** The kit as the renderer reads it (options with defaults applied). */
export interface Kit {
  readonly kinds: ReactKinds;
  readonly layout: Layout;
  readonly behavior?: Partial<Behavior>;
  readonly errors?: ErrorAdapter;
  readonly schema?: SchemaAdapter;
  readonly messages: Messages;
}
