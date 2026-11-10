import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createStore, equal, evaluate, Session } from "../src/core";
import { form, kinds } from "./kit";

type Values = { name: string; items: { name: string; qty: number | null; parts?: { id: string }[] }[] };
const start = (): Values => ({
  name: "A",
  items: [
    { name: "a", qty: 1 },
    { name: "b", qty: 2 },
    { name: "c", qty: 3 },
  ],
});

describe("values", () => {
  test("set copies along the path, untouched branches keep their identity", () => {
    const store = createStore(start());
    const before = store.getState().values;
    store.set("items.1.qty", 5);
    const after = store.getState().values;
    expect(after.items[1]?.qty).toBe(5);
    expect(before.items[1]?.qty).toBe(2);
    expect(after.items[0]).toBe(before.items[0]);
    expect(store.get("items.1.qty")).toBe(5);
  });

  test("an unchanged value does not notify", () => {
    const store = createStore(start());
    const listener = vi.fn();
    store.subscribe(listener);
    store.set("name", "A");
    expect(listener).not.toHaveBeenCalled();
    store.set("name", "B");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("batch notifies once", () => {
    const store = createStore(start());
    const listener = vi.fn();
    store.subscribe(listener);
    store.batch(() => {
      store.set("name", "B");
      store.set("items.0.qty", 9);
      store.touch("name");
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("dirty compares structurally with the initial values", () => {
    const store = createStore(start());
    expect(store.isDirty()).toBe(false);
    store.set("name", "B");
    expect(store.isDirty()).toBe(true);
    expect(store.isDirty("name")).toBe(true);
    expect(store.isDirty("items")).toBe(false);
    store.set("name", "A");
    expect(store.isDirty()).toBe(false);
  });

  test("reset starts over", () => {
    const store = createStore(start());
    store.batch(() => {
      store.set("name", "B");
      store.touch("name");
      store.setErrors({ name: "x" });
      store.markSubmitted();
    });
    store.reset({ ...start(), name: "C" });
    const s = store.getState();
    expect([s.values.name, s.initial.name, s.errors, s.touched.size, s.submitted]).toEqual(["C", "C", {}, 0, false]);
    expect(store.isDirty()).toBe(false);
  });
});

describe("errors", () => {
  test("scoped replacement keeps errors outside the scope", () => {
    const store = createStore(start());
    store.setErrors({ name: "Required", "items.0.qty": "Too small", "items.1.name": "Empty" });
    store.setErrors({ "items.0.qty": "Still too small" }, "items.0");
    expect(store.getState().errors).toEqual({ name: "Required", "items.0.qty": "Still too small", "items.1.name": "Empty" });
    store.setErrors({}, "items");
    expect(store.getState().errors).toEqual({ name: "Required" });
  });
});

describe("rows", () => {
  test("keys are stable and move with their rows", () => {
    const store = createStore(start());
    const [a, b, c] = store.rows.keys("items");
    expect(store.rows.keys("items")).toEqual([a, b, c]);

    store.rows.remove("items", 0);
    expect(store.rows.keys("items")).toEqual([b, c]);
    store.rows.move("items", 0, 1);
    expect(store.rows.keys("items")).toEqual([c, b]);
    store.rows.append("items", { name: "d", qty: 4 });
    const keys = store.rows.keys("items");
    expect(keys.slice(0, 2)).toEqual([c, b]);
    expect(new Set(keys).size).toBe(3);
    expect(store.getState().values.items.map((i) => i.name)).toEqual(["c", "b", "d"]);
  });

  test("errors and touched paths follow their rows", () => {
    const store = createStore(start());
    store.batch(() => {
      store.setErrors({ "items.0.qty": "e0", "items.1.qty": "e1", "items.2.qty": "e2", name: "n" });
      store.touch("items.2.name");
    });
    store.rows.remove("items", 1);
    expect(store.getState().errors).toEqual({ "items.0.qty": "e0", "items.1.qty": "e2", name: "n" });
    expect([...store.getState().touched]).toEqual(["items.1.name"]);

    store.rows.move("items", 1, 0);
    expect(store.getState().errors).toEqual({ "items.0.qty": "e2", "items.1.qty": "e0", name: "n" });

    store.rows.insert("items", 0, { name: "new", qty: null });
    expect(store.getState().errors).toEqual({ "items.1.qty": "e2", "items.2.qty": "e0", name: "n" });
  });

  test("nested lists keep their keys when the parent row moves", () => {
    const store = createStore<Values>({
      name: "",
      items: [
        { name: "a", qty: 1, parts: [{ id: "x" }] },
        { name: "b", qty: 2, parts: [{ id: "y" }, { id: "z" }] },
      ],
    });
    const nested = store.rows.keys("items.1.parts");
    store.rows.move("items", 1, 0);
    expect(store.rows.keys("items.0.parts")).toEqual(nested);
  });

  test("keyedPath survives removals", () => {
    const store = createStore(start());
    const before = store.keyedPath("items.2.qty");
    store.rows.remove("items", 0);
    expect(store.keyedPath("items.1.qty")).toBe(before);
    expect(store.keyedPath("name")).toBe("name");
  });
});

describe("session with row keys", () => {
  test("seen-history follows rows when an earlier row is removed", () => {
    const schema = z.object({ items: z.array(z.object({ name: z.string(), qty: z.number().nullable() })) });
    const { spec } = form(schema, (f) => ({
      sections: [{ fields: { items: f.rows((r) => ({ name: r.text("Name"), qty: r.number("Qty").if("name") })) } }],
    }));
    const store = createStore({
      items: [
        { name: "a", qty: 1 },
        { name: "", qty: 2 },
      ],
    });
    const session = new Session({ hidden: "empty-if-seen" }, kinds);
    const step = () => {
      const values = store.getState().values;
      const view = evaluate({ spec, values });
      for (const u of session.updates(view, values, store.keyedPath)) store.set(u.path, u.value);
    };
    // - row 0 shows qty (seen), row 1 never did: its qty 2 is a kept default
    step();
    store.rows.remove("items", 0);
    step();
    // - with plain paths row 1 (now 0) would inherit row 0's history and lose its qty
    expect(store.getState().values.items).toEqual([{ name: "", qty: 2 }]);
  });
});

describe("equal", () => {
  test("structural, dates by time, undefined keys absent", () => {
    expect(equal({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(equal({ a: undefined }, {})).toBe(true);
    expect(equal(new Date(1), new Date(1))).toBe(true);
    expect(equal([1], { 0: 1 })).toBe(false);
    expect(equal({ a: 1 }, { a: 2 })).toBe(false);
  });
});
