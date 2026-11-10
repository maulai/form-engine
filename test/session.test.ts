import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createForm, evaluate, kind, routeErrors, Session, setPath, type Behavior, type SpecData } from "../src/core";
import { form, kinds } from "./kit";

const schema = z.object({
  kind: z.enum(["person", "company"]),
  company: z.string(),
  vat: z.string(),
  currency: z.string(),
  note: z.string(),
  items: z.array(z.object({ name: z.string(), qty: z.number().nullable() })),
});
type Values = z.infer<typeof schema>;
const start: Values = { kind: "person", company: "", vat: "", currency: "EUR", note: "", items: [] };

/** Simulates a binding: evaluate, apply updates, repeat. */
function run(spec: SpecData, hidden: Behavior["hidden"] = "empty-if-seen") {
  const session = new Session({ hidden }, kinds);
  let values: Values = start;
  const step = (patch: Partial<Values> = {}, activePanel?: number) => {
    values = { ...values, ...patch };
    const view = evaluate({ spec, values, ...(activePanel !== undefined && { activePanel }) });
    for (const u of session.updates(view, values)) values = setPath(values, u.path, u.value);
    return values;
  };
  return { session, step, view: () => evaluate({ spec, values }), get values() { return values; } };
}

describe("hidden values: empty-if-seen", () => {
  const { spec } = form(schema, (f) => ({
    sections: [
      {
        fields: {
          kind: f.select("Kind", ["person", "company"]),
          company: f.text("Company").if("kind", "company"),
          currency: f.select("Currency", ["EUR"]).if("kind", "company"),
        },
      },
    ],
  }));

  test("never shown → value kept (defaults survive)", () => {
    const r = run(spec);
    // - currency is hidden from the start: its default must travel with the form
    expect(r.step()).toMatchObject({ currency: "EUR" });
  });

  test("shown, then hidden → emptied once", () => {
    const r = run(spec);
    r.step({ kind: "company" });
    r.step({ company: "ACME" });
    expect(r.step({ kind: "person" })).toMatchObject({ company: "", currency: "" });
    // - emptied once: a later value set by code stays
    expect(r.step({ company: "kept" })).toMatchObject({ company: "kept" });
  });

  test("reset starts a new history", () => {
    const r = run(spec);
    r.step({ kind: "company", company: "ACME" });
    r.session.reset();
    expect(r.step({ kind: "person" })).toMatchObject({ company: "ACME" });
  });

  test("a visible twin keeps the value", () => {
    const twin = form(schema, (f) => ({
      sections: [
        {
          fields: {
            kind: f.select("Kind", ["person", "company"]),
            company: f.text("Company").if("kind", "company"),
          },
        },
        { fields: { company: f.text("Company (read-only)").readOnly() } },
      ],
    }));
    const r = run(twin.spec);
    r.step({ kind: "company", company: "ACME" });
    expect(r.step({ kind: "person" })).toMatchObject({ company: "ACME" });
  });

  test("switching panels is not hiding", () => {
    const panels = form(schema, (f) => ({
      panels: [
        { name: "A", sections: [{ fields: { kind: f.select("Kind", ["person", "company"]) } }] },
        { name: "B", sections: [{ fields: { note: f.text("Note") } }] },
      ],
    }));
    const r = run(panels.spec);
    r.step({ note: "hello" }, 1);
    expect(r.step({}, 0)).toMatchObject({ note: "hello" });
  });

  test("fields seen in a panel are emptied when that panel's condition fails", () => {
    const panels = form(schema, (f) => ({
      panels: [
        { name: "A", sections: [{ fields: { kind: f.select("Kind", ["person", "company"]) } }] },
        { name: "B", if: ({ values }) => values.kind === "company", sections: [{ fields: { vat: f.text("VAT") } }] },
      ],
    }));
    const r = run(panels.spec);
    r.step({ kind: "company" }, 1);
    r.step({ vat: "DE1" }, 1);
    expect(r.step({ kind: "person" }, 0)).toMatchObject({ vat: "" });
  });

  test("hidden rows column is emptied per row", () => {
    const rows = form(schema, (f) => ({
      sections: [
        {
          fields: {
            items: f.rows((r) => ({ name: r.text("Name"), qty: r.number("Qty").if("name") })),
          },
        },
      ],
    }));
    const r = run(rows.spec);
    r.step({ items: [{ name: "A", qty: 2 }] });
    expect(r.step({ items: [{ name: "", qty: 2 }] }).items).toEqual([{ name: "", qty: null }]);
  });
});

describe("fixed values", () => {
  test("are written and win over hiding", () => {
    const { spec } = form(schema)
      .props<{ currency?: string }>()
      .define((f) => ({
        sections: [{ fields: { currency: f.select("Currency", ["EUR", "USD"]).fixed(({ props }) => props.currency) } }],
      }));
    const session = new Session({ hidden: "empty-if-seen" }, kinds);
    const view = evaluate({ spec, values: start, props: { currency: "USD" } });
    expect(session.updates(view, start)).toEqual([{ path: "currency", value: "USD" }]);
    expect(session.updates(view, { ...start, currency: "USD" })).toEqual([]);
  });
});

describe("other policies", () => {
  const { spec } = form(schema, (f) => ({
    sections: [{ fields: { kind: f.select("Kind", ["person", "company"]), company: f.text("Company").if("kind", "company") } }],
  }));

  test("omit removes hidden values at submit, never during editing", () => {
    const session = new Session({ hidden: "omit" }, kinds);
    const values = { ...start, company: "ACME" };
    const view = evaluate({ spec, values });
    expect(session.updates(view, values)).toEqual([]);
    expect(session.prepare(view, values)).not.toHaveProperty("company");
  });

  test("keep leaves everything", () => {
    const r = run(spec, "keep");
    r.step({ kind: "company", company: "ACME" });
    expect(r.step({ kind: "person" })).toMatchObject({ company: "ACME" });
  });
});

describe("error routing", () => {
  const { spec } = form(schema, (f) => ({
    panels: [
      { name: "A", sections: [{ fields: { kind: f.select("Kind", ["person", "company"]), company: f.text("Company").if("kind", "company") } }] },
      { name: "B", sections: [{ fields: { items: f.rows((r) => ({ name: r.text("Name") })) } }] },
    ],
  }));

  test("visible fields take their errors, the rest goes to the summary", () => {
    const view = evaluate({ spec, values: { ...start, items: [{ name: "", qty: 1 }] } });
    const routed = routeErrors(
      { "items.0.name": "Required", "items.0.qty": "Too small", company: "Hidden field", "": "Whole form", kind: "Pick one" },
      view,
    );
    // - ordered like the form; `items.0.qty` has no column, the list takes it
    expect(routed.placed).toEqual([
      { path: "kind", message: "Pick one" },
      { path: "items.0.name", message: "Required" },
      { path: "items.0.qty", message: "Too small" },
    ]);
    expect(routed.unplaced).toEqual(["Hidden field", "Whole form"]);
    expect([...routed.panels]).toEqual([1, 0]);
  });
});

describe("single option", () => {
  const choice = { pick: kind<string>({ empty: "" }).params((options: readonly string[]) => ({ options }), { options: (c) => c.options }) };
  const pickForm = createForm(choice);
  const s = z.object({ company: z.string(), other: z.string() });

  test("an empty choice with one option gets it; filled values and several options stay", () => {
    const { spec } = pickForm(s, (f) => ({
      sections: [{ fields: { company: f.pick("Company", ["only"]), other: f.pick("Other", ["a", "b"]) } }],
    }));
    const session = new Session({ hidden: "empty-if-seen", collapseSingleOption: true }, choice);
    const values = { company: "", other: "" };
    expect(session.updates(evaluate({ spec, values }), values)).toEqual([{ path: "company", value: "only" }]);
    const off = new Session({ hidden: "empty-if-seen", collapseSingleOption: false }, choice);
    expect(off.updates(evaluate({ spec, values }), values)).toEqual([]);
  });
});
