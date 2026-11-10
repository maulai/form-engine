import { createContext, memo, useContext, useMemo, type ComponentType, type ReactNode } from "react";
import {
  CONTENT_KINDS,
  equal,
  freeValues,
  getPath,
  passes,
  singleOption,
  type Controller,
  type Entry,
  type FieldDef,
  type FieldView,
  type Hint,
  type PanelStatus,
  type Tone,
  type RowView,
  type SectionView,
} from "../core";
import { useKindCheck } from "./control";
import { FieldContext, useFormContext } from "./context";
import { useControllerState, useStore } from "./hooks";
import type { FieldProps, HintView, PanelStatusView, ReadProps } from "./types";

// ── memo ───────────────────────────────────────────────────────────────────

const sameHint = (a: Hint | undefined, b: Hint | undefined) =>
  a === b ||
  (typeof a === "object" && typeof b === "object" && a.text === b.text && a.tone === b.tone && a.tooltip === b.tooltip);

/**
 * Whether a field renders the same.
 * - Shallow on purpose: `content` and `config` by identity (React nodes must never be deep-compared).
 * - The core rebuilds views on every change; this keeps unchanged fields from re-rendering.
 */
export function sameField(a: FieldView, b: FieldView): boolean {
  return (
    a.path === b.path &&
    a.kind === b.kind &&
    a.config === b.config &&
    a.def === b.def &&
    a.label === b.label &&
    sameHint(a.hint, b.hint) &&
    a.placeholder === b.placeholder &&
    a.wide === b.wide &&
    a.readOnly === b.readOnly &&
    Object.is(a.content, b.content) &&
    a.rowsOptions === b.rowsOptions &&
    sameRows(a.rows, b.rows)
  );
}

function sameRows(a: readonly RowView[] | undefined, b: readonly RowView[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i]!;
    return row.path === other.path && row.fields.length === other.fields.length && row.fields.every((f, j) => sameField(f, other.fields[j]!));
  });
}

// ── fields ─────────────────────────────────────────────────────────────────

/** One field: frame + input, subscribed to its own value and error only. */
export const FieldHost = memo(function FieldHost({ field }: { field: FieldView }) {
  if (field.kind === "rows") return <RowsHost field={field} />;
  return <FieldFrameHost field={field} />;
}, (a, b) => sameField(a.field, b.field));

function FieldFrameHost({ field }: { field: FieldView }) {
  const { controller, kit, idOf } = useFormContext();
  const error = useStore((s) => s.errors[field.path]);
  const id = idOf(field.path);
  const { FieldFrame } = kit.layout;
  // - a choice with exactly one option is no choice: the engine selected it, show it read-only
  const single = controller.behavior.collapseSingleOption && singleOption(kit.kinds[field.kind], field.config) !== undefined;
  const readOnly = field.readOnly || single;
  const row = useContext(RowPlace);

  return (
    <FieldFrame
      id={id}
      kind={field.kind}
      wide={field.wide}
      readOnly={readOnly}
      place={row ? "row" : "form"}
      {...(row?.as !== undefined && { as: row.as })}
      {...(field.label !== undefined && !kit.kinds[field.kind]?.labelInside && { label: field.label })}
      {...(field.hint !== undefined && { hint: hintView(field.hint) })}
      {...(error !== undefined && { error })}
      {...(controller.required(field.path) && { required: true })}
    >
      {/* - content gets the field context too: hooks like useRowArgs work inside display/note */}
      <FieldContext.Provider value={{ path: field.path, id, readOnly, scope: field.scope, ...(field.index !== undefined && { index: field.index }), ...(field.parentScope !== undefined && { parentScope: field.parentScope }) }}>
        {field.kind === "display" || field.kind === "note" ? (
          (field.content as ReactNode)
        ) : (
          <Input field={field} id={id} readOnly={readOnly} invalid={error !== undefined} onBlur={() => controller.blur(field.path)} />
        )}
      </FieldContext.Provider>
    </FieldFrame>
  );
}

function Input({ field, id, readOnly, invalid, onBlur }: { field: FieldView; id: string; readOnly: boolean; invalid: boolean; onBlur: () => void }) {
  const { controller, kit } = useFormContext();
  const raw = useStore((s) => getPath(s.values, field.path));
  const kind = kit.kinds[field.kind];
  const custom = field.kind === "custom" ? (field.config as { component: ComponentType<FieldProps<unknown, unknown>> }).component : undefined;
  if (!kind && !custom) throw new Error(`form-engine: unknown kind "${field.kind}" at "${field.path}"`);
  useKindCheck(field.kind, id);

  // - missing values render as the kind's empty value: inputs stay controlled
  const value = raw === undefined ? kind?.empty : raw;
  const common = {
    id,
    value,
    config: custom ? undefined : field.config,
    ...(field.label !== undefined && { label: field.label }),
  };
  if (readOnly && kind?.read) {
    const Read = kind.read as ComponentType<ReadProps<unknown, unknown>>;
    return <Read {...common} />;
  }
  const Component = (custom ?? kind!.render) as ComponentType<FieldProps<unknown, unknown>>;
  return (
    <Component
      {...common}
      onChange={(next) => controller.change(field.path, next)}
      onBlur={onBlur}
      readOnly={readOnly}
      invalid={invalid}
      {...(field.placeholder !== undefined && { placeholder: field.placeholder })}
    />
  );
}

// ── rows ───────────────────────────────────────────────────────────────────

type AddOption = string | false | { readonly label: string; readonly row?: (args: never) => unknown } | undefined;
type Removable = boolean | ((args: never) => boolean) | undefined;

const columnsOf = (field: FieldView) => ((field.config as { columns?: Entry[] } | undefined)?.columns ?? []) as Entry[];

/** A row with every column at its empty value, overlaid with `patch`. */
function useEmptyRow(field: FieldView) {
  const { controller } = useFormContext();
  return (patch: unknown = {}) => {
    const index = controller.store.rows.keys(field.path).length;
    const empty = Object.fromEntries(
      columnsOf(field)
        // - content columns (`total: r.display(...)`) hold no value
        .filter((c) => !CONTENT_KINDS.includes(c.def.kind))
        .map((c) => [c.key, controller.emptyValue(`${field.path}.${index}.${c.key}`, c.def)]),
    );
    return { ...empty, ...(patch as object) };
  };
}

function RowsHost({ field }: { field: FieldView }) {
  const { controller, kit, idOf } = useFormContext();
  const { Rows } = kit.layout;
  const options = field.rowsOptions ?? {};
  const rows = field.rows ?? [];
  const columns = columnsOf(field);
  const emptyRow = useEmptyRow(field);
  const keys = useStore(() => controller.store.rows.keys(field.path));
  const error = useStore((s) => s.errors[field.path]);
  const rowErrors = useStore((s) => rowErrorsOf(s.errors, field.path, columns), sameStrings);
  const navigation = useControllerState((s) => s.view.navigation);
  // - one object per list presentation, so cell contexts stay stable
  const place = useMemo(() => (options.as === undefined ? {} : { as: options.as }), [options.as]);

  const add = options.add as AddOption;
  const removable = options.removable as Removable;
  const count = rows.length;
  // - `.unique()`: free values for a new row, `null` when a unique column is used up
  const hasUnique = columns.some((c) => c.def.unique);
  const free = useStore(
    (s) => {
      if (!hasUnique) return NO_FREE;
      const list = getPath(s.values, field.path);
      const visible = (def: FieldDef, row: unknown, a: unknown) => passes(def.conditions, row, a as never);
      return freeValues(columns, kit.kinds, Array.isArray(list) ? list : [], listArgsOf(controller, field, s.values), visible);
    },
    equal,
  );
  const canAdd = !field.readOnly && add !== false && free !== null && (options.max === undefined || count < options.max);
  const canRemove = !field.readOnly && (options.min === undefined || count > options.min);

  // - a predicate may read the row: re-evaluated when any row value changes, re-renders only when a result flips
  const removableRows = useStore(
    (s) =>
      typeof removable === "function"
        ? rows.map((row) => (removable as (a: unknown) => boolean)({ ...listArgsOf(controller, field, s.values), row: getPath(s.values, row.path), index: row.index }))
        : NO_FLAGS,
    sameFlags,
  );

  // - own component with its own subscription: totals update without re-rendering the list
  const summary = options.summary ? <SummaryHost field={field} summary={options.summary as (a: unknown) => ReactNode} /> : undefined;
  // - sidebar pickers live in the dialog's left column, unless panels need it for navigation
  const picker = options.picker && (options.picker.options.placement !== "sidebar" || navigation) ? <PickerHost field={field} /> : undefined;

  const newRow = () => {
    // - `.unique()` columns start at their first free value; an explicit row wins
    const patch = typeof add === "object" && add.row ? (add.row as (a: unknown) => object)(listArgsOf(controller, field)) : {};
    return emptyRow({ ...free, ...patch });
  };

  return (
    <Rows
      id={idOf(field.path)}
      wide={field.wide}
      readOnly={field.readOnly}
      columns={columns.map((c) => ({ key: c.key, ...(typeof c.def.label === "string" && { label: c.def.label }) }))}
      rows={rows.map((row) => {
        const allowed = canRemove && (typeof removable === "function" ? removableRows[row.index] === true : removable !== false);
        const rowError = rowErrors[row.index];
        return {
          key: keys[row.index] ?? row.path,
          index: row.index,
          cells: row.fields.map((cell) => ({
            key: cell.key,
            // - cells know they sit in a list (and how it is shown): no label in a table cell, …
            node: (
              <RowPlace.Provider key={cell.key} value={place}>
                <FieldHost field={cell} />
              </RowPlace.Provider>
            ),
          })),
          ...(rowError !== undefined && { error: rowError }),
          ...(allowed && { onRemove: () => controller.rows.remove(field.path, row.index) }),
        };
      })}
      addLabel={typeof add === "string" ? add : typeof add === "object" ? add.label : kit.messages.add}
      {...(canAdd && { onAdd: () => controller.rows.append(field.path, newRow()) })}
      {...(options.sortable && !field.readOnly && { onMove: (from: number, to: number) => controller.rows.move(field.path, from, to) })}
      {...(options.as !== undefined && { as: options.as })}
      {...(options.empty !== undefined && { empty: options.empty })}
      {...(field.label !== undefined && { label: field.label })}
      {...(field.hint !== undefined && { hint: hintView(field.hint) })}
      {...(error !== undefined && { error })}
      {...(picker && !field.readOnly && { picker })}
      {...(summary !== undefined && { summary })}
    />
  );
}

function SummaryHost({ field, summary }: { field: FieldView; summary: (args: unknown) => ReactNode }) {
  const { controller } = useFormContext();
  return <>{useStore((s) => summary(listArgsOf(controller, field, s.values)))}</>;
}

const NO_FLAGS: boolean[] = [];
const NO_FREE: Record<string, unknown> = {};
const sameFlags = (a: boolean[], b: boolean[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── picker ─────────────────────────────────────────────────────────────────

type PickerDef = {
  readonly items: (args: unknown) => readonly unknown[];
  readonly key: (item: unknown) => string;
  readonly toRow: (item: unknown, args: unknown) => unknown;
  readonly label: (item: unknown) => unknown;
  readonly search?: (item: unknown) => string;
  readonly unique?: string;
  readonly placement?: "sidebar" | "inline";
  readonly placeholder?: string;
  readonly empty?: string;
  readonly custom?: { readonly label: string; readonly row: (args: unknown) => unknown };
  readonly disabled?: (args: unknown) => boolean;
};

/**
 * The picker of a list: items → rows.
 * - Re-reads items whenever their keys change (context, filters by values).
 * - Items whose key is already in the list (`unique`) are disabled.
 */
export function PickerHost({ field }: { field: FieldView }) {
  const { controller, kit } = useFormContext();
  const o = field.rowsOptions?.picker?.options as PickerDef | undefined;
  const emptyRow = useEmptyRow(field);
  const argsWith = (values: unknown) => listArgsOf(controller, field, values);

  const keys = useStore((s) => (o ? o.items(argsWith(s.values)).map(o.key) : []), sameStrings);
  const used = useStore((s) => {
    if (!o?.unique) return [];
    const list = getPath(s.values, field.path);
    return (Array.isArray(list) ? list : []).map((row) => String(getPath(row, o.unique!)));
  }, sameStrings);
  const disabled = useStore((s) => o?.disabled?.(argsWith(s.values)) ?? false);

  const entries = useMemo(() => {
    if (!o) return [];
    const taken = new Set(used);
    return o.items(listArgsOf(controller, field)).map((item) => {
      const key = o.key(item);
      const label = o.label(item);
      return { item, key, label: label as ReactNode, text: o.search?.(item) ?? (typeof label === "string" ? label : key), disabled: taken.has(key) };
    });
    // - `keys` stands for the items: recompute when they change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, keys, used]);

  if (!o) return null;
  const { Picker } = kit.layout;
  const append = (row: unknown) => controller.rows.append(field.path, emptyRow(row));
  return (
    <Picker
      items={entries.map(({ item: _item, ...entry }) => entry)}
      placement={o.placement ?? "inline"}
      disabled={disabled}
      onPick={(key) => {
        const entry = entries.find((e) => e.key === key);
        if (entry && !entry.disabled) append(o.toRow(entry.item, listArgsOf(controller, field)));
      }}
      {...(o.placeholder !== undefined && { placeholder: o.placeholder })}
      {...(o.empty !== undefined && { empty: o.empty })}
      {...(o.custom && { custom: { label: o.custom.label, onAdd: () => append(o.custom!.row(listArgsOf(controller, field))) } })}
    />
  );
}

/** The first list in the active panel whose picker belongs in the dialog's left column. */
export function sidebarPickerField(sections: readonly SectionView[]): FieldView | undefined {
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.kind === "rows" && !field.readOnly && field.rowsOptions?.picker?.options.placement === "sidebar") return field;
    }
  }
  return undefined;
}

/** Errors at `items.<i>` or below it that no column shows, per row index. */
function rowErrorsOf(errors: Record<string, string>, path: string, columns: readonly Entry[]): string[] {
  const result: string[] = [];
  const prefix = `${path}.`;
  for (const [p, message] of Object.entries(errors)) {
    if (!p.startsWith(prefix)) continue;
    const [index, column] = p.slice(prefix.length).split(".");
    if (column !== undefined && columns.some((c) => c.key === column || c.key.startsWith(`${column}.`))) continue;
    const i = Number(index);
    if (Number.isInteger(i)) result[i] ??= message;
  }
  return result;
}

const sameStrings = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── sections and panels ────────────────────────────────────────────────────

export function Sections({ sections }: { sections: readonly SectionView[] }) {
  const { kit } = useFormContext();
  const { Section } = kit.layout;
  return (
    <>
      {sections.map((section) => (
        <Section
          key={section.index}
          {...(section.name !== undefined && { name: section.name })}
          {...(section.description !== undefined && { description: section.description })}
          {...(section.before !== undefined && { before: section.before as ReactNode })}
          {...(section.after !== undefined && { after: section.after as ReactNode })}
        >
          {section.fields.map((field) => (
            <FieldHost key={field.path} field={field} />
          ))}
        </Section>
      ))}
    </>
  );
}

export function PanelNavHost() {
  const { controller, kit } = useFormContext();
  const panels = useControllerState((s) => s.view.panels);
  const invalid = useControllerState((s) => s.errorPanels);
  const { PanelNav } = kit.layout;
  return (
    <PanelNav
      panels={panels.map((p) => ({
        index: p.index,
        name: p.name,
        active: p.active,
        invalid: invalid.has(p.index),
        ...statusView(p.status, invalid.has(p.index), kit.messages.panelInvalid),
      }))}
      onSelect={controller.setPanel}
    />
  );
}


/**
 * Arguments of list-level callbacks (`add`, `picker`, `summary`, `removable`).
 * - `parent`: the row the list sits in (nested lists), `undefined` at form level.
 */
function listArgsOf(controller: Controller, field: FieldView, values: unknown = controller.store.getState().values) {
  return { ...controller.args(), values, parent: field.scope ? getPath(values, field.scope) : undefined };
}

/** Set for the cells of a list: where they sit and how the list is shown. */
const RowPlace = createContext<{ readonly as?: "table" | "cards" | "inline" } | null>(null);

/** A hint as the kit gets it: always an object. */
function hintView(hint: Hint): HintView {
  return typeof hint === "string" ? { text: hint } : hint;
}

/**
 * A panel state as the kit gets it: state and tone always set.
 * - An error in the panel beats whatever the panel reports.
 */
function statusView(status: PanelStatus | undefined, invalid: boolean, invalidHint: string): { status?: PanelStatusView } {
  if (invalid) return { status: { state: "incomplete", tone: "danger", hint: invalidHint } };
  if (status === undefined) return {};
  const s = typeof status === "string" ? { state: status } : status;
  const tone: Tone = s.tone ?? (s.state === "complete" ? "success" : s.state === "incomplete" ? "warning" : "neutral");
  return { status: { state: s.state, tone, ...(s.hint !== undefined && { hint: s.hint }) } };
}
