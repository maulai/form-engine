import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createController, createForm, evaluate, freeValues, kind, passes, type FieldDef, type FieldView, type View } from "../src/core";

const choice = {
  text: kind<string>({ empty: "" }),
  number: kind<number | null>({ empty: null }),
  pick: kind<string>({ empty: "" }).params((options: readonly string[]) => ({ options }), {
    options: (c) => c.options,
    withOptions: (c, values) => ({ options: c.options.filter((o) => values.includes(o)) }),
  }),
};
const form = createForm(choice);
const fields = (view: View): FieldView[] => view.panels.flatMap((p) => p.sections.flatMap((s) => s.fields));

describe("effects", () => {
  const s = z.object({ a: z.string(), b: z.string(), items: z.array(z.object({ x: z.string() })), sum: z.string() });
  const run = vi.fn();
  const def = form(s, (f) => ({
    effects: [
      { on: ["a", "b"], run: ({ values, set }) => (run(), set("sum", `${values.a}+${values.b}`)) },
      { on: ["items"], run: ({ values, set }) => set("b", String(values.items.length)) },
    ],
    sections: [{ fields: { a: f.text("A"), b: f.text("B"), items: f.rows((r) => ({ x: r.text("X") })) } }],
  }));

  test("run on user changes of the watched paths, with the new values", () => {
    run.mockClear();
    const c = createController({ definition: def, kinds: choice, action: vi.fn() });
    c.open({ value: { a: "1", b: "2", items: [], sum: "" } });
    expect(run).not.toHaveBeenCalled();
    c.change("a", "5");
    expect((c.store.getState().values as { sum: string }).sum).toBe("5+2");
    // - a programmatic set is no user change
    c.store.set("a", "9");
    expect((c.store.getState().values as { sum: string }).sum).toBe("5+2");
  });

  test("changes below a watched path and list operations count", () => {
    const c = createController({ definition: def, kinds: choice, action: vi.fn() });
    c.open({ value: { a: "", b: "", items: [{ x: "" }], sum: "" } });
    c.rows.append("items", { x: "" });
    expect((c.store.getState().values as { b: string }).b).toBe("2");
    c.change("items.0.x", "y");
    expect((c.store.getState().values as { b: string }).b).toBe("2");
  });
});

describe("unique", () => {
  const s = z.object({ lines: z.array(z.object({ place: z.string(), qty: z.number().nullable() })) });
  const def = form(s, (f) => ({
    sections: [{ fields: { lines: f.rows((r) => ({ place: r.pick("Place", ["a", "b", "c"]).unique(), qty: r.number("Qty") })) } }],
  }));
  const options = (view: View, i: number) => (fields(view)[0]!.rows![i]!.fields[0]!.config as { options: string[] }).options;

  test("each row offers its own value plus the unused ones", () => {
    const view = evaluate({ spec: def.spec, values: { lines: [{ place: "a", qty: 1 }, { place: "b", qty: 1 }] }, kinds: choice });
    expect(options(view, 0)).toEqual(["a", "c"]);
    expect(options(view, 1)).toEqual(["b", "c"]);
  });

  test("a new row gets the first free value; none left → null", () => {
    const columns = (def.spec.panels[0]!.sections[0]!.fields[0]!.def.config as { columns: never[] }).columns;
    const visible = (d: FieldDef, row: unknown, a: unknown) => passes(d.conditions, row, a as never);
    const args = { values: {}, ctx: undefined, props: {}, edit: false, parent: undefined };
    expect(freeValues(columns, choice, [{ place: "a" }], args, visible)).toEqual({ place: "b" });
    expect(freeValues(columns, choice, [{ place: "a" }, { place: "b" }, { place: "c" }], args, visible)).toBeNull();
  });

  test("the last free value collapses to read-only and gets selected", () => {
    const c = createController({ definition: def, kinds: choice, action: vi.fn() });
    c.open({ value: { lines: [{ place: "a", qty: 1 }, { place: "b", qty: 1 }, { place: "", qty: 1 }] } });
    // - row 2 can only take "c": collapseSingleOption selects it
    expect((c.store.getState().values as { lines: { place: string }[] }).lines[2]!.place).toBe("c");
  });
});
