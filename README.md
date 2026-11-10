# @maulai/form-engine

Declarative, headless forms for React. A form is one `const`. The engine supplies the
behaviour: validation timing, error mapping, hidden values, saving, autosave, dialogs and
focus. Your app's **kit** supplies every visual block and every input.

```tsx
export const ContactForm = form(contactSchema, (f) => ({
  title: "Contact",
  sections: [
    {
      name: "General",
      fields: {
        name: f.text("Name").wide(),
        newsletter: f.switch("Newsletter"),
        email: f.text("E-mail").if("newsletter"),
      },
    },
  ],
}));

<ContactForm trigger={<Button>New</Button>} action={createContact} />   // dialog
<ContactForm inline value={contact} action={updateContact} />           // on the page
```

- No dependencies; peer: `react >= 18`.
- Any [Standard Schema](https://standardschema.dev) validator (zod, valibot, arktype, …).
- `@maulai/form-engine` is framework-free (core); `@maulai/form-engine/react` is the binding.

## Install

```bash
npm i @maulai/form-engine
```

During local development, link the package and keep it building:

```bash
# in form-engine
npm run dev          # tsup --watch → dist/
# in the app
npm i ../form-engine # "file:../form-engine"
```

## 1. The kit (once per app)

The engine ships **no inputs and no markup**. You register your components:

```tsx
// lib/form-kit.tsx
import { createFormKit, kind, type FieldProps, type Layout } from "@maulai/form-engine/react";

function TextField({ id, value, onChange, onBlur, readOnly, invalid, placeholder }: FieldProps<string>) {
  return <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
                readOnly={readOnly} placeholder={placeholder} aria-invalid={invalid} />;
}

function SelectField({ id, value, onChange, readOnly, config }: FieldProps<string, { options: Options }>) { … }

const layout: Layout = { Dialog, Inline, PanelNav, Section, FieldFrame, Rows, SubmitButton,
                         Summary, ConfirmDialog, AutosaveStatus, Picker, Loading };

export const { form } = createFormKit({
  kinds: {
    text: kind(TextField, { empty: "" }),                                   // f.text(label)
    number: kind(NumberField, { empty: null }),
    select: kind(SelectField, (options: Options) => ({ options }),          // f.select(label, options)
                 { empty: "", options: (c) => [...c.options.keys()],        // enables "single option" and .unique()
                   withOptions: (c, keys) => ({ options: new Map([...c.options].filter(([k]) => keys.includes(k))) }) }),
    country: kind(CountrySelect, (scope: Scope) => ({ scope }), { read: CountryName }), // read view when read-only
  },
  layout,
  errors: apiErrorAdapter,   // optional, see "Errors"
  schema: schemaAdapter,     // optional: empty values, required markers
  messages: { submit: "Speichern", add: "Hinzufügen" /* … */ },
  behavior: { /* rarely: see "Rules" */ },
});
```

**Kinds**
- `kind(Component, setup?, { empty?, read?, options?, withOptions?, labelInside? })`; `labelInside`: the component renders
  its label itself (checkbox, switch), `FieldFrame` gets none
- Value and config types come from `FieldProps<V, Config>`, so `f.money(...)` only fits number paths.
- `FieldProps`: `id`, `value`, `onChange`, `onBlur`, `label`, `placeholder`, `readOnly`, `invalid`, `config`.
- An input renders the control only. Label, hint and error come from `FieldFrame`.
- Spread `controlProps(props)` onto the control: `id`, `onBlur`, `readOnly`, `aria-invalid`, `placeholder` in one go.
  A kind that renders no element with `props.id` gets a console warning (once per kind): labels and
  focus-on-error would not reach it.
- Domain inputs belong here too: a whole position table can be one kind, built with `useRows()`.

**Layout components:** all props are typed, see `DialogProps`, `FieldFrameProps`, `RowsProps`, … in the exports.

| Component | Renders |
|---|---|
| `Dialog` | `open`, `onOpenChange`, `trigger`, `title`, `size`; `nav` (panels) or `aside` (sidebar picker) → sidebar layout; `children`, `footer` |
| `Inline` | the same without the dialog |
| `Section` | `name`, `description`, `before`, `after`, children = field frames: a grid whose column count is the kit's call (`wide` spans all; e.g. one column in small dialogs via a container query) |
| `FieldFrame` | `id`, `label`, `hint` (always `{ text, tone?, tooltip? }`), `error`, `required`, `wide`, `readOnly`, `place` (`"form"` or `"row"` + the list's `as`: e.g. no label in a table cell), children = the input |
| `Rows` | `as` (table/cards/inline), `columns`, `rows[{ key, cells, error, onRemove }]`, `onAdd`, `onMove`, `picker`, `summary` |
| `Picker` | `items[{ key, label, text, disabled }]`, `onPick`, `placement`, `custom`, `disabled` |
| `SubmitButton` | `form` (use as the button's `form` attribute), `label`, `pending`, `saved`, `disabled`, `destructive` |
| `PanelNav` | `panels[{ index, name, active, invalid, status }]`, `onSelect`; `status` is normalised `{ state, tone, hint? }`, an error in the panel makes it `incomplete` / `danger` with `messages.panelInvalid` |
| `Summary`, `ConfirmDialog`, `AutosaveStatus`, `Loading` | as named |

## 2. Forms

```ts
form(schema, (f) => spec)                                         // short
form(schema).props<P>().context(() => ctx).define((f) => spec)    // with own props / hook data
```

### Spec

| Key | |
|---|---|
| `title`, `description` | static or `({ values, ctx, props, edit }) => …`; every text may resolve to `undefined` (= none / the kit's default) |
| `defaults(value, { ctx, props })` | values on open; annotate `value` to type the call site's `value` prop |
| `sections: [{ name, description, if, fields, before, after }]` | or `panels: [{ name, if, status, sections }]` (sidebar navigation) |
| `toInput(data, args)` | validated values → action input; `null` cancels |
| `confirm: { retry: (data) => ({ ...data, force: true }), title, action }` | the server asked to confirm (error adapter): retry with these values |
| `effects: [{ on: ["a", "b"], run: ({ values, set }) => set("c", …) }]` | when the user changes a watched value (or below it), recompute another; typed, no annotations |
| `submit: { label, icon, destructive }`, `size`, `autosave: true \| ms`, `afterSubmit: "close" \| "reset" \| "keep"` | |

`fields` is an object keyed by **typed path** (`"address.city"`). Each path appears once.
Every dynamic property receives one argument: `{ values, ctx, props, edit }`, plus `row` and `index` in lists
and `parent` in nested lists.

### Fields

```ts
f.text("Name")
  .wide()                                  // full grid width
  .if("newsletter")                        // shown when present
  .if("kind", "company", "club")           // shown for these values
  .if(({ values, ctx, edit }) => …)
  .createOnly() / .editOnly()
  .label(x) .hint(x) .placeholder(x)       // x: value or function; hint may be { text, tone, tooltip }
  .readOnly(x?)                            // read view of the same kind
  .lockedOnEdit()                          // editable on create, read-only on edit (keys)
  .fixed(({ props }) => props.ownerId)     // caller fixes the value: set + read-only
  .onChange((value, { set, args }) => set("currency", …))   // user changes only, may be async
  .config(({ values, row, parent }) => ({ options: … }))    // config that depends on values (typed by the kind)
  .unique()                                // in a list: each value once; new rows get the next free one
```

Engine builders:

```ts
f.when("period", { day: f.date("Date"), range: f.date("From") })   // variant per value, none = hidden
f.display(({ values }) => total(values))                            // content at a path
f.note("Shown on the receipt.")
f.custom(MyComponent)                                               // escape hatch, see hooks
```

### Lists

```ts
items: f.rows(
  (r) => ({
    title: r.text("Title"),
    qty: r.number("Qty"),
    state: r.text("State").if("country", "DE"),   // row-relative paths, ({ row, index }) in functions
    total: r.display(({ row }) => row.qty * row.price).label("Total"),   // content: any key, no value
  }),
  {
    as: "cards", add: "Add item", sortable: true, min: 1, max: 20,
    removable: ({ row }) => row.kind === "custom",
    summary: ({ values }) => `Total ${sum(values)}`,
    picker: f.picker({
      items: ({ ctx }) => ctx.products,          // Item is inferred
      key: (p) => p.id,
      label: (p) => p.name,
      toRow: (p) => ({ product_id: p.id, title: p.name, qty: 1 }),
      unique: "product_id",                      // picked items are disabled
      placement: "sidebar",                      // or "inline" (above the rows)
      disabled: ({ values }) => !values.customer_id,
      custom: { label: "Custom line", row: () => ({ title: "" }) },
    }),
  },
),
```

Columns are keyed by path; content without a value (`display`, `note`) may use any key, an input under
an unknown key is a type error (typo).

Options are the **second argument**, not a chain: `f.rows(...).as(...)` would lose the row type.
`add` and `picker` may also be functions of the list arguments (`({ props }) => …`; `false` / `undefined` = none);
return a picker defined once, typed by its list: `const p = f.picker("items", { … })` inside the definition.
A list with a sidebar picker opens as a wide dialog, like one with panels.

Nested lists: `r.rows((s) => ({ … }))` inside a row; their functions get `parent` (the enclosing row),
and `r.picker(...)` gives a nested list a picker.

## 3. Call site

| Prop | |
|---|---|
| `action(input)` | save; throw to reject |
| `value` | record to edit (sets `edit`); without it the form creates |
| `onSuccess(result)` | gets the action's result (navigate, show a secret) |
| `trigger` / `open` + `onOpenChange` / `inline` | presentation: chosen here, not in the spec |
| `pending` | data still loading: placeholders, no submit |
| `readOnly` | show the record only: every field read-only, no submit (switching it starts a fresh session) |
| `title`, `description`, `submitLabel` | per call site |
| your `.props<P>()` | passed alongside |

```tsx
const edit = useFormDialog(TagForm, { action: updateTag });   // tables: one dialog, fresh per open
rows.map((t) => <button onClick={() => edit.open(t)}>Edit</button>); {edit.element}
```

A context hook that returns `undefined` also means "loading". Inside the spec `ctx` is never `undefined`.

## 4. Custom code

Use these inside `f.custom(...)`, inside kinds, or in any component under a form:

```ts
const field = useField<number>();   // { value, set, blur, error, readOnly, id, path }
const product = useArgs(({ row, parent, ctx, props }) => …);   // arguments of this field; select to limit re-renders
const total = useValues((v) => sum(v.items));
const rows = useRows<Line>("items"); // { keys, rows, append, insert, remove, move }
const api = useFormApi();            // { get, set, submit, isDirty, reset, busy }
// api.reset(): back to the opened values · await api.busy(upload(file)): submit waits for it
```

`set` counts as a user change: effects, validation timing and autosave apply.
Content of `display` / `note` runs inside the field too, so these hooks work there.

The same hooks, typed by a form (no casts):

```ts
const customerId = OrderForm.useValues((v) => v.customer_id);
const product = OrderForm.useRowArgs("lines", ({ row, props }) => props.products.find((p) => p.id === row.product_id));
const currency = OrderForm.useArgs(({ props }) => props.currency);
```

## 5. Errors and schema

```ts
// kit option `errors`: whatever `action` throws → what the form shows
const apiErrorAdapter: ErrorAdapter = (error) => {
  if (isSignedOut(error)) { redirectToLogin(); return null; }      // handled: show nothing
  if (isConfirmRequired(error)) return { confirm: { message: error.message } };   // the form says how to retry
  return { message: error.message, fields: fieldErrorsOf(error) }; // { "items.2.qty": "Too small" }
};

// kit option `schema` (optional): one adapter, called with the schema of the form at hand
const schemaAdapter: SchemaAdapter = {
  emptyValue: (path, schema) => …,   // { value } — what a cleared field becomes (default: the kind's `empty`)
  required: (path, schema) => …,     // required marker in FieldFrame
};
```

Field errors at a visible field show there; all others go to the `Summary`. A submit never fails silently.
A confirm request is answered by the form's `confirm.retry`; without one it shows as an ordinary error.

## Rules (the opinions)

These hold for every form; the kit may change them once via `behavior`:

| Rule | Default |
|---|---|
| `hidden` | `"empty-if-seen"`: a field shown and then hidden is emptied; a field never shown keeps its default. Panel switches do not hide. Alternatives: `"omit"`, `"keep"` |
| `validation` | `"submit-then-blur"`: nothing before the first submit, then on blur; while typing errors only disappear. Autosave forms validate on change |
| `collapseSingleOption` | a choice with exactly one option is selected and shown read-only |
| `focusFirstError` | after a failed submit: focus, scroll, switch panel |
| `confirmDiscard` | closing a dirty dialog asks first; leaving the page with unsaved changes asks too (`beforeunload`) |
| `autosaveDelay` | 800 ms; saves are latest-wins, flushed on page hide and unmount |

Also built in: Ctrl/Cmd+Enter submits, a fresh session on every open, and rows with stable keys (errors move with their row).

## Migrating an existing form

| Before | Now |
|---|---|
| a second field on the same path for display (edit mode / fixed by caller) | `.lockedOnEdit()` / `.fixed(...)` / `.readOnly()` |
| effect component calling `setValue` when another field changes | `.onChange((v, { set }) => …)` on that field |
| shared field array between a picker and a table (provider) | `f.rows(..., { picker: f.picker(...) })`, one store |
| wrapper component that injects hook data | `.context(() => ({ … }))` |
| transform before submit | `toInput` |
| per-form override flag after a server confirm | `confirm: { retry: (data) => ({ ...data, flag: true }) }` |
| options computed in a render slot | `.config(({ values, row, parent }) => ({ options }))` |
| render slots with form-library APIs | a kind, or `f.custom(...)` with `useField` / `useRows` |
| `invalidates` / navigation props | inside `action` / `onSuccess(result)` |
| `hidden: (v, ctx, edit) => …` | `.if(...)`, `.createOnly()`, `.editOnly()` |

Out of scope: URL-bound filter bars, scanner/quick-capture flows, single-control actions.
Multi-step flows are custom components whose steps are forms.

## Requirements and limits

- React ≥ 18, TypeScript ≥ 5.4 (`NoInfer`). The `/react` entry is marked `"use client"` for server-component frameworks.
- `Form.useRowArgs(path, …)` covers top-level lists; in nested lists use `useArgs` (it has `parent`).
- Free keys for content (`total: r.display(…)`) exist in list columns, not in sections (use `before` / `after`).
- The missing-`id` warning for kinds is active in every build (one check per kind).
- Every change re-evaluates the form: about 5–6 ms for 500 rows × 5 columns in the core; one input re-renders.

## License

MIT
