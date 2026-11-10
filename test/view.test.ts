import { describe, expect, test } from "vitest";
import { z } from "zod";
import { evaluate, initialValues, type FieldView, type View } from "../src/core";
import { form } from "./kit";

const schema = z.object({
  name: z.string(),
  kind: z.enum(["person", "company"]),
  newsletter: z.boolean(),
  email: z.string(),
  company: z.object({ name: z.string() }),
  period: z.enum(["day", "range", "none"]),
  from: z.string(),
  to: z.string(),
  addresses: z.array(z.object({ street: z.string(), country: z.string(), state: z.string() })),
});
type Values = z.infer<typeof schema>;

const values = (patch: Partial<Values> = {}): Values => ({
  name: "Ada",
  kind: "person",
  newsletter: false,
  email: "",
  company: { name: "" },
  period: "none",
  from: "",
  to: "",
  addresses: [],
  ...patch,
});

/** All visible fields of all rendered sections, flattened. */
const fields = (view: View): FieldView[] => view.panels.flatMap((p) => p.sections.flatMap((s) => s.fields));
const keys = (view: View) => fields(view).map((f) => f.key);

describe("visibility", () => {
  const { spec } = form(schema, (f) => ({
    sections: [
      {
        fields: {
          name: f.text("Name"),
          newsletter: f.switch("Newsletter"),
          email: f.text("E-mail").if("newsletter"),
          "company.name": f.text("Company").if("kind", "company"),
        },
      },
    ],
  }));

  test("path conditions: presence and equality", () => {
    expect(keys(evaluate({ spec, values: values() }))).toEqual(["name", "newsletter"]);
    expect(keys(evaluate({ spec, values: values({ newsletter: true, kind: "company" }) }))).toEqual([
      "name",
      "newsletter",
      "email",
      "company.name",
    ]);
  });

  test("hidden fields still produce slots", () => {
    const slots = evaluate({ spec, values: values() }).slots;
    expect(slots.map((s) => [s.path, s.visible])).toEqual([
      ["name", true],
      ["newsletter", true],
      ["email", false],
      ["company.name", false],
    ]);
  });

  test("edit conditions and lockedOnEdit", () => {
    const { spec } = form(schema, (f) => ({
      sections: [{ fields: { name: f.text("Name").lockedOnEdit(), email: f.text("E-mail").createOnly() } }],
    }));
    const create = evaluate({ spec, values: values() });
    const edit = evaluate({ spec, values: values(), edit: true });
    expect(keys(create)).toEqual(["name", "email"]);
    expect(fields(create)[0]?.readOnly).toBe(false);
    expect(keys(edit)).toEqual(["name"]);
    expect(fields(edit)[0]?.readOnly).toBe(true);
  });

  test("section conditions hide all their fields", () => {
    const { spec } = form(schema, (f) => ({
      sections: [{ if: "newsletter", fields: { email: f.text("E-mail") } }],
    }));
    const view = evaluate({ spec, values: values() });
    expect(view.panels[0]?.sections).toEqual([]);
    expect(view.slots[0]?.visible).toBe(false);
  });
});

describe("dynamic properties", () => {
  test("label, hint, placeholder, title and section content resolve with args", () => {
    const { spec } = form(schema)
      .props<{ prefix: string }>()
      .context(() => ({ count: 3 }))
      .define((f) => ({
        title: ({ edit }) => (edit ? "Edit" : "New"),
        sections: [
          {
            name: ({ ctx }) => `Items (${ctx.count})`,
            after: ({ values }) => `Hello ${values.name}`,
            fields: {
              name: f
                .text(({ props }) => `${props.prefix} name`)
                .hint(({ values }) => ({ text: `${values.name.length} chars`, tone: "info" }))
                .placeholder("Type"),
            },
          },
        ],
      }));
    const view = evaluate({ spec, values: values(), ctx: { count: 3 }, props: { prefix: "Your" }, edit: true });
    const section = view.panels[0]?.sections[0];
    expect(view.title).toBe("Edit");
    expect(section?.name).toBe("Items (3)");
    expect(section?.after).toBe("Hello Ada");
    expect(fields(view)[0]).toMatchObject({
      label: "Your name",
      hint: { text: "3 chars", tone: "info" },
      placeholder: "Type",
    });
  });
});

describe("when", () => {
  const { spec } = form(schema, (f) => ({
    sections: [
      {
        fields: {
          from: f.when("period", { day: f.date("Date"), range: f.date("From") }).wide(),
          to: f.when("period", { range: f.date("To") }),
        },
      },
    ],
  }));

  test("picks the case per value, hides without a case", () => {
    expect(fields(evaluate({ spec, values: values({ period: "none" }) }))).toEqual([]);
    const day = fields(evaluate({ spec, values: values({ period: "day" }) }));
    expect(day.map((f) => [f.key, f.kind, f.label, f.wide])).toEqual([["from", "date", "Date", true]]);
    const range = fields(evaluate({ spec, values: values({ period: "range" }) }));
    expect(range.map((f) => f.label)).toEqual(["From", "To"]);
  });
});

describe("fixed", () => {
  test("a fixed value is read-only and reported in its slot", () => {
    const { spec } = form(schema)
      .props<{ kind?: "person" | "company" }>()
      .define((f) => ({ sections: [{ fields: { kind: f.select("Kind", ["person", "company"]).fixed(({ props }) => props.kind) } }] }));
    const free = evaluate({ spec, values: values(), props: {} });
    const locked = evaluate({ spec, values: values(), props: { kind: "company" } });
    expect(fields(free)[0]?.readOnly).toBe(false);
    expect(free.slots[0]?.fixed).toBeUndefined();
    expect(fields(locked)[0]?.readOnly).toBe(true);
    expect(locked.slots[0]?.fixed).toEqual({ value: "company" });
  });
});

describe("rows", () => {
  const { spec } = form(schema, (f) => ({
    sections: [
      {
        fields: {
          addresses: f.rows(
            (r) => ({
              street: r.text(({ index }) => `Street ${index + 1}`),
              country: r.select("Country", ["DE", "AT"]),
              state: r.text("State").if("country", "DE"),
            }),
            { as: "cards", add: "Add" },
          ),
        },
      },
    ],
  }));

  test("rows resolve per row with row-relative conditions", () => {
    const view = evaluate({
      spec,
      values: values({
        addresses: [
          { street: "A", country: "DE", state: "BY" },
          { street: "B", country: "AT", state: "" },
        ],
      }),
    });
    const list = fields(view)[0];
    expect(list?.rowsOptions).toEqual({ as: "cards", add: "Add" });
    expect(list?.rows?.map((r) => r.fields.map((f) => [f.path, f.label]))).toEqual([
      [
        ["addresses.0.street", "Street 1"],
        ["addresses.0.country", "Country"],
        ["addresses.0.state", "State"],
      ],
      [
        ["addresses.1.street", "Street 2"],
        ["addresses.1.country", "Country"],
      ],
    ]);
    expect(view.slots.find((s) => s.path === "addresses.1.state")?.visible).toBe(false);
  });
});

describe("panels", () => {
  const { spec } = form(schema, (f) => ({
    panels: [
      { name: "General", sections: [{ fields: { name: f.text("Name") } }] },
      {
        name: "Company",
        if: ({ values }) => values.kind === "company",
        status: ({ values }) => (values.company.name ? "complete" : "incomplete"),
        sections: [{ fields: { "company.name": f.text("Company") } }],
      },
      { name: "Contact", sections: [{ fields: { email: f.text("E-mail") } }] },
    ],
  }));

  test("only visible panels, only the active one renders sections", () => {
    const view = evaluate({ spec, values: values(), activePanel: 2 });
    expect(view.panels.map((p) => [p.index, p.name, p.active, p.sections.length])).toEqual([
      [0, "General", false, 0],
      [2, "Contact", true, 1],
    ]);
    // - fields of inactive panels still have slots, marked inactive
    expect(view.slots.map((s) => [s.path, s.visible, s.active])).toEqual([
      ["name", true, false],
      ["company.name", false, false],
      ["email", true, true],
    ]);
  });

  test("status and fallback when the active panel disappears", () => {
    const view = evaluate({ spec, values: values({ kind: "company" }), activePanel: 1 });
    expect(view.panels[1]).toMatchObject({ name: "Company", status: "incomplete", active: true });
    const gone = evaluate({ spec, values: values({ kind: "person" }), activePanel: 1 });
    expect(gone.activePanel).toBe(0);
  });
});

describe("initial values", () => {
  test("defaults get record, ctx and props; without defaults the record is used", () => {
    const withDefaults = form(schema)
      .props<{ kind: "person" | "company" }>()
      .define((f) => ({
        defaults: (value: Values | undefined, { props }) => ({ ...value, kind: props.kind }),
        sections: [{ fields: { name: f.text("Name") } }],
      }));
    expect(initialValues(withDefaults.spec, { value: values(), props: { kind: "company" } })).toMatchObject({ kind: "company", name: "Ada" });

    const plain = form(schema, (f) => ({ sections: [{ fields: { name: f.text("Name") } }] }));
    expect(initialValues(plain.spec, { value: values() })).toEqual(values());
    expect(initialValues(plain.spec, {})).toEqual({});
  });
});
