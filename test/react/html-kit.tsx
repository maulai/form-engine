// A plain-HTML kit for tests: what an app writes once for its UI library.
// - Counts renders per field id, so tests can assert that typing re-renders one field only.
import type { ReactNode } from "react";
import { controlProps, createFormKit, kind, type FieldProps, type Layout } from "../../src/react";

export const renders = new Map<string, number>();
const count = (id: string) => renders.set(id, (renders.get(id) ?? 0) + 1);

// - controlProps wires id, onBlur, readOnly, aria-invalid and placeholder in one spread
function TextInput(props: FieldProps<string>) {
  count(props.id);
  return <input {...controlProps(props)} value={props.value} onChange={(e) => props.onChange(e.target.value)} />;
}

function NumberInput({ id, value, onChange, onBlur, readOnly }: FieldProps<number | null>) {
  count(id);
  return (
    <input
      id={id}
      type="number"
      value={value ?? ""}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      onBlur={onBlur}
    />
  );
}

function Checkbox({ id, value, onChange, onBlur, readOnly }: FieldProps<boolean>) {
  return <input id={id} type="checkbox" checked={value} disabled={readOnly} onChange={(e) => onChange(e.target.checked)} onBlur={onBlur} />;
}

type Options = readonly string[];
function Select({ id, value, onChange, onBlur, readOnly, config }: FieldProps<string, { options: Options }>) {
  return (
    <select id={id} value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}>
      <option value="" />
      {config.options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export const layout: Layout = {
  Dialog: ({ open, onOpenChange, trigger, title, size, nav, aside, children, footer }) => (
    <>
      {trigger && <span onClick={() => onOpenChange(true)}>{trigger}</span>}
      {open && (
        <div role="dialog" aria-label={title} data-size={size}>
          <h2>{title}</h2>
          <button type="button" onClick={() => onOpenChange(false)}>
            Close
          </button>
          {nav}
          {aside && <aside>{aside}</aside>}
          {children}
          {footer}
        </div>
      )}
    </>
  ),
  Inline: ({ title, nav, children, footer }) => (
    <section aria-label={title}>
      {nav}
      {children}
      {footer}
    </section>
  ),
  PanelNav: ({ panels, onSelect }) => (
    <nav>
      {panels.map((p) => (
        <button key={p.index} type="button" aria-current={p.active || undefined} data-invalid={p.invalid || undefined} data-tone={p.status?.tone} title={p.status?.hint} onClick={() => onSelect(p.index)}>
          {p.name}
        </button>
      ))}
    </nav>
  ),
  Section: ({ name, children, after }) => (
    <fieldset>
      {name && <legend>{name}</legend>}
      {children}
      {after as ReactNode}
    </fieldset>
  ),
  // - a table cell shows no label (the header names the column); `place`/`as` say where the frame sits
  FieldFrame: ({ id, label, hint, error, place, as, children }) => (
    <div data-place={place}>
      {label && !(place === "row" && as === "table") && <label htmlFor={id}>{label}</label>}
      {children}
      {hint && <small data-tone={hint.tone}>{hint.text}</small>}
      {error && <p role="alert">{error}</p>}
    </div>
  ),
  Rows: ({ label, rows, onAdd, addLabel, error, picker, summary }) => (
    <div role="group" aria-label={label}>
      {picker}
      {rows.map((row) => (
        <div key={row.key} data-row={row.index}>
          {row.cells.map((c) => (
            <span key={c.key}>{c.node}</span>
          ))}
          {row.error && <p role="alert">{row.error}</p>}
          {row.onRemove && (
            <button type="button" onClick={row.onRemove}>
              Remove {row.index}
            </button>
          )}
        </div>
      ))}
      {onAdd && (
        <button type="button" onClick={onAdd}>
          {addLabel}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {summary && <footer>{summary}</footer>}
    </div>
  ),
  SubmitButton: ({ form, label, pending, saved, disabled }) => (
    <button type="submit" form={form} disabled={pending || disabled}>
      {saved ? "Saved" : pending ? "Saving" : label}
    </button>
  ),
  Summary: ({ messages }) => (
    <ul aria-label="summary">
      {messages.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  ),
  ConfirmDialog: ({ open, title, message, confirm, cancel, onConfirm, onCancel }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <p>{message}</p>
        <button type="button" onClick={onConfirm}>
          {confirm}
        </button>
        <button type="button" onClick={onCancel}>
          {cancel}
        </button>
      </div>
    ) : null,
  AutosaveStatus: ({ pending, saved }) => <output>{pending ? "Saving" : saved ? "Saved" : ""}</output>,
  Loading: () => <p role="status">Loading</p>,
  Picker: ({ items, onPick, placement, custom, disabled }) => (
    <div role="listbox" aria-label={`picker ${placement}`} aria-disabled={disabled || undefined}>
      {items.map((item) => (
        <button key={item.key} type="button" role="option" aria-selected={false} disabled={disabled || item.disabled} onClick={() => onPick(item.key)}>
          {item.label}
        </button>
      ))}
      {custom && (
        <button type="button" onClick={custom.onAdd}>
          {custom.label}
        </button>
      )}
    </div>
  ),
};

export const kinds = {
  text: kind(TextInput, { empty: "" }),
  number: kind(NumberInput, { empty: null }),
  checkbox: kind(Checkbox, { empty: false }),
  select: kind(Select, (options: Options) => ({ options }), {
    empty: "",
    options: (config) => config.options,
    withOptions: (config, values) => ({ options: config.options.filter((o) => values.includes(o)) }),
  }),
};

export const { form, kit } = createFormKit({ kinds, layout });
