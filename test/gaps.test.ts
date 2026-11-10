import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createController, evaluate, type ErrorAdapter, type FieldView, type SchemaAdapter, type View } from "../src/core";
import { form, kinds } from "./kit";

const fields = (view: View): FieldView[] => view.panels.flatMap((p) => p.sections.flatMap((s) => s.fields));

const order = z.object({
  mode: z.enum(["normal", "special"]),
  force: z.boolean(),
  price: z.number(),
  items: z.array(z.object({ title: z.string(), sources: z.array(z.object({ qty: z.number().nullable(), place: z.string() })) })),
});
type Order = z.infer<typeof order>;
const value: Order = {
  mode: "normal",
  force: false,
  price: 5,
  items: [{ title: "A", sources: [{ qty: 1, place: "x" }, { qty: 2, place: "y" }] }],
};

describe("parent in nested lists", () => {
  test("columns, config and effects see the enclosing row", () => {
    const { spec } = form(order, (f) => ({
      sections: [
        {
          fields: {
            items: f.rows((r) => ({
              sources: r.rows((s) => ({
                qty: s.number("Qty").hint(({ parent, index }) => `${parent.title}#${index}`),
              })),
            })),
          },
        },
      ],
    }));
    const view = evaluate({ spec, values: value });
    const sources = fields(view)[0]!.rows![0]!.fields[0]!;
    expect(sources.rows!.map((r) => r.fields[0]!.hint)).toEqual(["A#0", "A#1"]);
    expect(sources.rows![1]!.fields[0]).toMatchObject({ scope: "items.0.sources.1", index: 1, parentScope: "items.0" });
  });

  test("onChange gets parent and sets row-relative paths", () => {
    const def = form(order, (f) => ({
      sections: [
        {
          fields: {
            items: f.rows((r) => ({
              sources: r.rows((s) => ({
                qty: s.number("Qty").onChange((_q, { set, args }) => set("place", `${args.parent.title}-${args.index}`)),
              })),
            })),
          },
        },
      ],
    }));
    const c = createController({ definition: def, kinds, action: vi.fn() });
    c.open({ value });
    c.change("items.0.sources.1.qty", 9);
    expect((c.store.getState().values as Order).items[0]!.sources[1]).toEqual({ qty: 9, place: "A-1" });
  });
});

describe(".config(fn)", () => {
  const def = form(order, (f) => ({
    sections: [
      {
        fields: {
          items: f.rows((r) => ({
            sources: r.rows((s) => ({
              // - places the other rows of the same parent do not use yet
              place: s
                .select("Place", [])
                .config(({ parent, index }) => ({ options: ["x", "y", "z"].filter((p) => !parent.sources.some((o, i) => i !== index && o.place === p)) })),
            })),
          })),
        },
      },
    ],
  }));
  const placeOf = (view: View, i: number) => fields(view)[0]!.rows![0]!.fields[0]!.rows![i]!.fields[0]!;

  test("merged per evaluation, stable by identity while equal", () => {
    const memo = new Map<string, unknown>();
    const first = evaluate({ spec: def.spec, values: value, memo });
    expect(placeOf(first, 0).config).toEqual({ options: ["x", "z"] });
    const again = evaluate({ spec: def.spec, values: { ...value }, memo });
    expect(placeOf(again, 0).config).toBe(placeOf(first, 0).config);
  });

  test("a single derived option is selected", () => {
    const choice = { pick: { ...kinds.select, options: (c: { options: readonly string[] }) => c.options } };
    const s = z.object({ a: z.string(), b: z.string() });
    const d = createController({
      definition: form(s, (f) => ({ sections: [{ fields: { a: f.select("A", ["one", "two"]), b: f.select("B", []).config(({ values }) => ({ options: [values.a] })) } }] })),
      kinds: { ...kinds, ...{ select: choice.pick } },
      action: vi.fn(),
    });
    d.open({ value: { a: "one", b: "" } });
    expect((d.store.getState().values as { b: string }).b).toBe("one");
  });
});

describe("add and picker per case", () => {
  test("resolved with the list arguments", () => {
    const def = form(order)
      .props<{ special: boolean }>()
      .define((f) => {
        const titles = f.picker({ items: () => ["a"], key: (t) => t, label: (t) => t, toRow: (t) => ({ title: t, sources: [] }) });
        return {
          sections: [
            {
              fields: {
                items: f.rows((r) => ({ title: r.text("Title") }), {
                  picker: ({ props }) => (props.special ? undefined : titles),
                  add: ({ props }) => props.special && "Special line",
                }),
              },
            },
          ],
        };
      });
    const normal = fields(evaluate({ spec: def.spec, values: value, props: { special: false } }))[0]!.rowsOptions!;
    const special = fields(evaluate({ spec: def.spec, values: value, props: { special: true } }))[0]!.rowsOptions!;
    expect([normal.add, normal.picker !== undefined]).toEqual([false, true]);
    expect([special.add, special.picker]).toEqual(["Special line", undefined]);
  });
});

describe("confirm per form", () => {
  const confirmOnly: ErrorAdapter = (e) => ((e as Error).message === "confirm" ? { confirm: { message: "Sure?" } } : { message: String(e) });
  const failUnlessForced = vi.fn(async (input: Order) => {
    if (!input.force) throw new Error("confirm");
    return "ok";
  });

  test("the spec's retry answers the request, with its own wording", async () => {
    const def = form(order, (f) => ({
      confirm: { retry: (data) => ({ ...data, force: true }), title: "Override?", action: "Save anyway" },
      sections: [{ fields: { mode: f.select("Mode", ["normal", "special"]) } }],
    }));
    const c = createController({ definition: def, kinds, errors: confirmOnly, action: failUnlessForced });
    c.open({ value });
    expect((await c.submit()).status).toBe("confirm");
    expect(c.getState().confirm).toMatchObject({ message: "Sure?", title: "Override?", action: "Save anyway" });
    expect(await c.confirm()).toEqual({ status: "success", result: "ok" });
  });

  test("without a retry anywhere the request is a plain error", async () => {
    const def = form(order, (f) => ({ sections: [{ fields: { mode: f.select("Mode", ["normal", "special"]) } }] }));
    const c = createController({ definition: def, kinds, errors: confirmOnly, action: failUnlessForced });
    c.open({ value });
    expect(await c.submit()).toEqual({ status: "failed", error: { message: "Sure?" } });
    expect(c.getState().summary).toEqual(["Sure?"]);
  });
});

describe("schema adapter gets the form's schema", () => {
  test("empty values and required markers per form", () => {
    const seen: unknown[] = [];
    const adapter: SchemaAdapter = {
      emptyValue: (path, schema) => {
        seen.push(schema);
        return path === "price" ? { value: 0 } : undefined;
      },
      required: (path, schema) => schema === order && path === "price",
    };
    const def = form(order, (f) => ({ sections: [{ fields: { mode: f.select("Mode", ["normal"]), price: f.number("Price").if("mode", "special") } }] }));
    const c = createController({ definition: def, kinds, schema: adapter, action: vi.fn() });
    c.open({ value: { ...value, mode: "special" } });
    c.change("mode", "normal");
    // - a number without "null" in the schema empties to 0, not to the kind's null
    expect((c.store.getState().values as Order).price).toBe(0);
    expect(seen.every((s) => s === order)).toBe(true);
    expect([c.required("price"), c.required("mode")]).toEqual([true, false]);
  });
});

describe("content columns", () => {
  test("display cells under a free key are computed per row and hold no value", async () => {
    const s = z.object({ items: z.array(z.object({ qty: z.number().nullable(), price: z.number() })) });
    const def = form(s, (f) => ({
      sections: [{ fields: { items: f.rows((r) => ({ qty: r.number("Qty"), total: r.display(({ row }) => (row.qty ?? 0) * row.price).label("Total") })) } }],
    }));
    const action = vi.fn(async (v: unknown) => v);
    const c = createController({ definition: def, kinds, action });
    c.open({ value: { items: [{ qty: 2, price: 3 }] } });
    const total = () => fields(c.getState().view)[0]!.rows![0]!.fields.find((f) => f.key === "total")!;
    expect([total().content, total().label, total().path]).toEqual([6, "Total", "items.0.total"]);
    c.change("items.0.qty", 5);
    expect(total().content).toBe(15);
    await c.submit();
    expect(action).toHaveBeenCalledWith({ items: [{ qty: 5, price: 3 }] });
  });
});
