// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { form, renders } from "./html-kit";

afterEach(cleanup);

// - regression guard for large lists; numbers are logged for the plan
// - generous timeout: rendering and querying 1500 inputs in happy-dom takes seconds
test("one keystroke in a 500-row list re-renders one field", { timeout: 30_000 }, () => {
  const row = z.object({ a: z.string(), b: z.string(), c: z.number().nullable() });
  const schema = z.object({ items: z.array(row) });
  const ListForm = form(schema, (f) => ({
    sections: [{ fields: { items: f.rows((r) => ({ a: r.text("A"), b: r.text("B").if("a"), c: r.number("C") })) } }],
  }));
  const items = Array.from({ length: 500 }, (_, i) => ({ a: `a${i}`, b: "", c: i }));

  const t0 = performance.now();
  render(<ListForm inline action={vi.fn()} value={{ items }} />);
  const mount = performance.now() - t0;

  const target = screen.getAllByLabelText("B")[250]!;
  renders.clear();
  const runs = 10;
  const t1 = performance.now();
  for (let i = 0; i < runs; i++) fireEvent.change(target, { target: { value: `v${i}` } });
  const perKeystroke = (performance.now() - t1) / runs;

  const rendered = [...renders.values()].reduce((a, b) => a + b, 0) / runs;
  console.log(`mount: ${mount.toFixed(0)} ms, per keystroke: ${perKeystroke.toFixed(1)} ms, inputs rendered per keystroke: ${rendered}`);
  expect(rendered).toBe(1);
  expect(perKeystroke).toBeLessThan(100);
});
