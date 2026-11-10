import { describe, expectTypeOf, test } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { form } from "./kit";
import { form as reactForm } from "./react/html-kit";

const contactSchema = z.object({
  name: z.string().min(1),
  email: z.string(),
  newsletter: z.boolean(),
  age: z.number().nullable(),
  kind: z.enum(["person", "company"]),
  company: z.object({ name: z.string(), vat_id: z.string().optional() }),
  addresses: z.array(z.object({ street: z.string(), country: z.string(), state: z.string().optional() })),
  tags: z.array(z.string()),
});
type Contact = z.infer<typeof contactSchema>;
type Stored = Contact & { id: string };

describe("short form", () => {
  test("realistic form compiles without annotations", () => {
    const ContactForm = form(contactSchema, (f) => ({
      title: ({ edit }) => (edit ? "Edit contact" : "New contact"),
      defaults: (value: Stored | undefined) => value ?? { kind: "person" },
      sections: [
        {
          name: "General",
          fields: {
            name: f.text("Name").wide(),
            kind: f.select("Kind", ["person", "company"]),
            newsletter: f.switch("Newsletter"),
            email: f.text("E-mail").if("newsletter").hint("We never share it."),
            age: f.number("Age").if(({ values }) => values.kind === "person"),
            "company.name": f.text("Company").if("kind", "company"),
            "company.vat_id": f.text("VAT ID").if("kind", "company").lockedOnEdit(),
            tags: f.tags("Tags", ["a", "b"]),

          },
        },
        {
          name: "Addresses",
          if: "name",
          after: ({ values }) => `${values.addresses.length} addresses`,
          fields: {
            addresses: f.rows(
              (r) => ({
                street: r.text("Street"),
                country: r.select("Country", ["DE", "AT"]),
                state: r.text("State").if("country", "DE").placeholder(({ row }) => `State in ${row.country}`),
              }),
              { as: "cards", add: "Add address", removable: ({ index }) => index > 0 },
            ),
          },
        },
      ],
    }));
    type Types = NonNullable<(typeof ContactForm)["~types"]>;
    expectTypeOf<Types["value"]>().toEqualTypeOf<Stored>();
    expectTypeOf<Types["input"]>().toEqualTypeOf<Contact>();
  });

  test("toInput defines the action input", () => {
    const F = form(contactSchema, (f) => ({
      toInput: (data) => ({ fullName: data.name }),
      sections: [{ fields: { name: f.text("Name") } }],
    }));
    expectTypeOf<NonNullable<(typeof F)["~types"]>["input"]>().toEqualTypeOf<{ fullName: string }>();
  });

  test("when switches the field per value", () => {
    form(contactSchema, (f) => ({
      sections: [
        {
          fields: {
            email: f.when("kind", { person: f.text("Private e-mail"), company: f.text("Office e-mail") }),
          },
        },
      ],
    }));
  });

  test("valibot schemas work the same", () => {
    const schema = v.object({ title: v.string(), done: v.boolean() });
    form(schema, (f) => ({ sections: [{ fields: { title: f.text("Title"), done: f.switch("Done") } }] }));
  });
});

describe("chain with props and context", () => {
  test("props and ctx are typed everywhere", () => {
    form(contactSchema)
      .props<{ lockedKind?: "person" | "company" }>()
      .context(() => ({ countries: new Map([["DE", "Germany"]]), canEditTags: true }))
      .define((f) => ({
        defaults: (_value, { props }) => ({ kind: props.lockedKind ?? "person" }),
        sections: [
          {
            fields: {
              kind: f.select("Kind", ["person", "company"]).fixed(({ props }) => props.lockedKind),
              name: f.text("Name").onChange((name, { set }) => set("email", `${name.toLowerCase()}@example.com`)),
              tags: f.tags("Tags", ["a"]).readOnly(({ ctx }) => !ctx.canEditTags),
              addresses: f.rows((r) => ({
                country: r.select("Country", ["DE"]).hint(({ ctx, row }) => ctx.countries.get(row.country)),
              })),
            },
          },
        ],
      }));
  });
});

describe("panels", () => {
  test("panels replace sections", () => {
    form(contactSchema, (f) => ({
      panels: [
        { name: "General", sections: [{ fields: { name: f.text("Name") } }] },
        {
          name: "Company",
          if: ({ values }) => values.kind === "company",
          status: ({ values }) => (values.company.name ? "complete" : "incomplete"),
          sections: [{ fields: { "company.name": f.text("Company") } }],
        },
      ],
    }));
  });
});

describe("errors are caught", () => {
  // - one error per form: TypeScript drops excess-key errors when a literal has other errors

  test("unknown path", () => {
    form(contactSchema, (f) => ({
      // @ts-expect-error - unknown path
      sections: [{ fields: { nmae: f.text("Name") } }],
    }));
  });

  test("kind cannot edit the value at the path", () => {
    // @ts-expect-error - text cannot edit a number
    form(contactSchema, (f) => ({ sections: [{ fields: { age: f.text("Age") } }] }));
    // @ts-expect-error - number cannot edit a string
    form(contactSchema, (f) => ({ sections: [{ fields: { name: f.number("Name") } }] }));
  });

  test("conditions are checked", () => {
    form(contactSchema, (f) => ({
      // @ts-expect-error - unknown condition path
      sections: [{ fields: { email: f.text("E-mail").if("newsleter") } }],
    }));
    form(contactSchema, (f) => ({
      // @ts-expect-error - value not in the enum
      sections: [{ fields: { email: f.text("E-mail").if("kind", "club") } }],
    }));
  });

  test("when rejects unknown cases", () => {
    form(contactSchema, (f) => ({
      // @ts-expect-error - "club" is not a kind
      sections: [{ fields: { email: f.when("kind", { person: f.text("a"), club: f.text("b") }) } }],
    }));
  });

  test("rows are typed by their path", () => {
    form(contactSchema, (f) => ({
      // @ts-expect-error - unknown column
      sections: [{ fields: { addresses: f.rows((r) => ({ zip: r.text("Zip") })) } }],
    }));
    form(contactSchema, (f) => ({
      // @ts-expect-error - row conditions are relative to the row
      sections: [{ fields: { addresses: f.rows((r) => ({ street: r.text("Street").if("newsletter") })) } }],
    }));
  });

  test("set() checks the value type", () => {
    form(contactSchema, (f) => ({
      // @ts-expect-error - age is a number
      sections: [{ fields: { name: f.text("Name").onChange((_n, { set }) => set("age", "old")) } }],
    }));
  });
});

describe("M3 typing", () => {
  type Product = { id: string; code: string; price: number };
  const order = z.object({ lines: z.array(z.object({ product_id: z.string(), qty: z.number(), price: z.number() })) });

  test("picker: item inferred from items, rows checked against the list", () => {
    form(order)
      .context(() => ({ products: [] as Product[] }))
      .define((f) => ({
        sections: [
          {
            fields: {
              lines: f.rows((r) => ({ qty: r.number("Qty") }), {
                picker: f.picker({
                  items: ({ ctx }) => ctx.products,
                  key: (p) => p.id,
                  label: (p) => p.code,
                  toRow: (p) => ({ product_id: p.id, qty: 1, price: p.price }),
                  unique: "product_id",
                  placement: "sidebar",
                }),
                summary: ({ values }) => values.lines.length,
              }),
            },
          },
        ],
      }));
  });

  test("picker rows that do not fit the list are rejected", () => {
    form(order)
      .context(() => ({ products: [] as Product[] }))
      .define((f) => ({
        sections: [
          {
            fields: {
              lines: f.rows((r) => ({ qty: r.number("Qty") }), {
                // @ts-expect-error - `sku` is not a column of the list
                picker: f.picker({ items: ({ ctx }) => ctx.products, key: (p) => p.id, label: (p) => p.code, toRow: (p) => ({ sku: p.id }) }),
              }),
            },
          },
        ],
      }));
  });

  test("a context hook may return undefined while loading; ctx is never undefined in the spec", () => {
    const useLoading = (): { products: Product[] } | undefined => undefined;
    form(order)
      .context(useLoading)
      .define((f) => ({
        title: ({ ctx }) => `${ctx.products.length} products`,
        sections: [{ fields: { lines: f.rows((r) => ({ qty: r.number("Qty") })) } }],
      }));
  });
});

describe("five gaps", () => {
  const order = z.object({
    mode: z.enum(["normal", "special"]),
    force: z.boolean(),
    items: z.array(z.object({ title: z.string(), sources: z.array(z.object({ qty: z.number().nullable(), place: z.string() })) })),
  });

  test("nested lists see their parent row, typed", () => {
    form(order, (f) => ({
      sections: [
        {
          fields: {
            items: f.rows((r) => ({
              title: r.text("Title"),
              sources: r.rows((s) => ({
                qty: s.number("Qty").hint(({ parent, row }) => `${parent.title}: ${row.place}`),
                place: s.select("Place", []).config(({ parent }) => ({ options: parent.sources.map((x) => x.place) })),
              })),
            })),
          },
        },
      ],
    }));
  });

  test(".config is typed by the kind's config", () => {
    form(order, (f) => ({
      sections: [
        {
          fields: {
            // @ts-expect-error - `choices` is not part of the select config
            mode: f.select("Mode", ["normal"]).config(() => ({ choices: [] })),
          },
        },
      ],
    }));
  });

  test("picker and add per case", () => {
    form(order)
      .props<{ special: boolean }>()
      .define((f) => {
        const titles = f.picker({ items: () => ["a", "b"], key: (t) => t, label: (t) => t, toRow: (t) => ({ title: t, sources: [] }) });
        return {
          sections: [
            {
              fields: {
                items: f.rows((r) => ({ title: r.text("Title") }), {
                  picker: ({ props }) => (props.special ? undefined : titles),
                  add: ({ props }) => props.special && "Add special line",
                }),
              },
            },
          ],
        };
      });
  });

  test("confirm retries on the validated values", () => {
    form(order, (f) => ({
      confirm: { retry: (data) => ({ ...data, force: true }), title: "Override?", action: ({ values }) => `Save ${values.mode}` },
      sections: [{ fields: { mode: f.select("Mode", ["normal", "special"]) } }],
    }));
    form(order, (f) => ({
      // @ts-expect-error - force is a boolean
      confirm: { retry: (data) => ({ ...data, force: "yes" }) },
      sections: [{ fields: { mode: f.select("Mode", ["normal", "special"]) } }],
    }));
  });
});

describe("content columns and optional texts", () => {
  const s = z.object({ items: z.array(z.object({ qty: z.number().nullable(), price: z.number() })) });

  test("a list may carry content under a free key", () => {
    form(s, (f) => ({
      sections: [
        {
          description: ({ edit }) => (edit ? "Editing" : undefined),
          fields: {
            items: f.rows((r) => ({
              qty: r.number("Qty"),
              total: r.display(({ row }) => (row.qty ?? 0) * row.price).label("Total"),
              info: r.note("per piece"),
            })),
          },
        },
      ],
    }));
  });

  test("inputs under a free key are typos", () => {
    form(s, (f) => ({
      sections: [
        {
          fields: {
            // @ts-expect-error - `qtty` is no path: only content may use a free key
            items: f.rows((r) => ({ qtty: r.number("Qty") })),
          },
        },
      ],
    }));
    form(s, (f) => ({
      sections: [
        {
          fields: {
            // @ts-expect-error - f.custom holds a value, so it needs a path too
            items: f.rows((r) => ({ extra: r.custom(() => null) })),
          },
        },
      ],
    }));
  });
});

describe("picker by path and typed hooks", () => {
  const order = z.object({ brand: z.string(), lines: z.array(z.object({ product_id: z.string(), qty: z.number() })) });
  type P = { id: string; name: string };

  test("f.picker(path, …) types the rows without generics", () => {
    form(order)
      .context(() => ({ products: [] as P[] }))
      .define((f) => {
        const products = f.picker("lines", {
          items: ({ ctx }) => ctx.products,
          key: (p) => p.id,
          label: (p) => p.name,
          toRow: (p) => ({ product_id: p.id, qty: 1 }),
          unique: "product_id",
        });
        return { sections: [{ fields: { lines: f.rows((r) => ({ qty: r.number("Qty") }), { picker: products }) } }] };
      });

    form(order, (f) => {
      // @ts-expect-error - `brand` is not a list
      f.picker("brand", { items: () => [], key: () => "", label: () => "", toRow: () => ({}) });
      // @ts-expect-error - `sku` is not a column of `lines`
      f.picker("lines", { items: () => [""], key: (s) => s, label: (s) => s, toRow: (s) => ({ sku: s }) });
      return { sections: [{ fields: { brand: f.text("Brand") } }] };
    });
  });

  test("hooks on the form component are typed by it", () => {
    const Order = reactForm(order)
      .props<{ currency: string }>()
      .define((f) => ({ sections: [{ fields: { brand: f.text("Brand") } }] }));
    expectTypeOf(Order.useValues((v) => v.brand)).toEqualTypeOf<string>();
    expectTypeOf(Order.useArgs(({ props }) => props.currency)).toEqualTypeOf<string>();
    expectTypeOf(Order.useRowArgs("lines", ({ row, index }) => [row.qty, index] as const)).toEqualTypeOf<readonly [number, number]>();
    // @ts-expect-error - `brand` is not a list
    Order.useRowArgs("brand", () => 0);
  });
});

describe("effects and unique typing", () => {
  const s = z.object({ a: z.string(), n: z.number(), items: z.array(z.object({ x: z.string() })) });

  test("effects: watched paths and set are typed", () => {
    form(s, (f) => ({
      effects: [{ on: ["a", "items"], run: ({ values, set }) => set("n", values.a.length) }],
      sections: [{ fields: { a: f.text("A"), items: f.rows((r) => ({ x: r.select("X", ["1"]).unique() })) } }],
    }));
    form(s, (f) => ({
      // @ts-expect-error - unknown path in `on`
      effects: [{ on: ["nope"], run: () => {} }],
      sections: [{ fields: { a: f.text("A") } }],
    }));
    form(s, (f) => ({
      // @ts-expect-error - `n` is a number
      effects: [{ on: ["a"], run: ({ set }) => set("n", "x") }],
      sections: [{ fields: { a: f.text("A") } }],
    }));
  });
});
