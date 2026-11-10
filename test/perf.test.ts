import { expect, test } from "vitest";
import { z } from "zod";
import { createController } from "../src/core";
import { form, kinds } from "./kit";

// - a large list form; regression guard, generous for slow CI (baseline 2026-11: ~8 ms)
test("one change in a 500-row list", () => {
  const row = z.object({ a: z.string(), b: z.string(), c: z.number().nullable(), d: z.string(), e: z.string() });
  const schema = z.object({ title: z.string(), items: z.array(row) });
  const def = form(schema, (f) => ({
    sections: [
      {
        fields: {
          title: f.text("Title"),
          items: f.rows((r) => ({
            a: r.text("A"),
            b: r.text("B").if("a"),
            c: r.number("C"),
            d: r.select("D", ["x", "y"]),
            e: r.text("E").if("d", "x"),
          })),
        },
      },
    ],
  }));
  const items = Array.from({ length: 500 }, (_, i) => ({ a: `a${i}`, b: "", c: i, d: "x", e: "" }));
  const c = createController({ definition: def, kinds, action: async () => 1 });
  c.open({ value: { title: "", items } });

  const runs = 20;
  const start = performance.now();
  for (let i = 0; i < runs; i++) c.change("items.250.b", `v${i}`);
  const perChange = (performance.now() - start) / runs;
  console.log(`per change: ${perChange.toFixed(2)} ms`);
  expect(perChange).toBeLessThan(50);
});
