import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createForm, getPath, kind, setPath, validate } from "../src/core";
import { form } from "./kit";

const schema = z.object({
  name: z.string().min(1, "Required"),
  newsletter: z.boolean(),
  email: z.string(),
  kind: z.enum(["person", "company"]),
  addresses: z.array(z.object({ street: z.string(), country: z.string() })),
});

describe("builders", () => {
  test("modifiers accumulate immutably", () => {
    const def = form(schema, (f) => {
      const base = f.text("E-mail");
      const shown = base.if("newsletter").hint("Never shared").wide();
      // - the base builder is untouched
      expect(base.def).toEqual({ kind: "text", label: "E-mail" });
      return { sections: [{ fields: { email: shown } }] };
    });
    expect(def.spec.panels[0]?.sections[0]?.fields).toEqual([
      {
        key: "email",
        def: { kind: "text", label: "E-mail", hint: "Never shared", wide: true, conditions: [{ type: "path", path: "newsletter" }] },
      },
    ]);
  });

  test("conditions keep their kind", () => {
    const test = () => true;
    const { spec } = form(schema, (f) => ({
      sections: [
        { fields: { email: f.text("E-mail").if("kind", "person", "company").if(test).createOnly().lockedOnEdit() } },
      ],
    }));
    const def = spec.panels[0]?.sections[0]?.fields[0]?.def;
    expect(def?.conditions).toEqual([
      { type: "path", path: "kind", equals: ["person", "company"] },
      { type: "test", test },
      { type: "edit", edit: false },
    ]);
    expect(def?.lockedOnEdit).toBe(true);
  });

  test("kind params run through setup", () => {
    const { spec } = form(schema, (f) => ({ sections: [{ fields: { kind: f.select("Kind", ["person", "company"]) } }] }));
    expect(spec.panels[0]?.sections[0]?.fields[0]?.def.config).toEqual({ options: ["person", "company"] });
  });

  test("when and rows nest definitions", () => {
    const { spec } = form(schema, (f) => ({
      sections: [
        {
          fields: {
            email: f.when("kind", { person: f.text("Private"), company: f.text("Office") }),
            addresses: f.rows((r) => ({ street: r.text("Street"), country: r.select("Country", ["DE"]) }), { as: "cards" }),
          },
        },
      ],
    }));
    const [when, rows] = spec.panels[0]?.sections[0]?.fields ?? [];
    expect(when?.def.cases).toEqual({
      path: "kind",
      fields: { person: { kind: "text", label: "Private" }, company: { kind: "text", label: "Office" } },
    });
    expect(rows?.def.config).toEqual({
      columns: [
        { key: "street", def: { kind: "text", label: "Street" } },
        { key: "country", def: { kind: "select", label: "Country", config: { options: ["DE"] } } },
      ],
      options: { as: "cards" },
    });
  });

  test("sections become one panel without navigation", () => {
    const { spec } = form(schema, (f) => ({ title: "Contact", sections: [{ name: "General", fields: { name: f.text("Name") } }] }));
    expect(spec.navigation).toBe(false);
    expect(spec.title).toBe("Contact");
    expect(spec.panels).toHaveLength(1);
  });

  test("panels keep navigation", () => {
    const { spec } = form(schema, (f) => ({
      panels: [
        { name: "A", sections: [{ fields: { name: f.text("Name") } }] },
        { name: "B", sections: [{ fields: { email: f.text("E-mail") } }] },
      ],
    }));
    expect(spec.navigation).toBe(true);
    expect(spec.panels.map((p) => p.name)).toEqual(["A", "B"]);
  });

  test("chain keeps the context hook", () => {
    const hook = () => ({ answer: 42 });
    const def = form(schema).props<{ x?: string }>().context(hook).define((f) => ({ sections: [{ fields: { name: f.text("Name") } }] }));
    expect(def.context).toBe(hook);
  });

  test("reserved kind names are rejected", () => {
    expect(() => createForm({ rows: kind<string>() })).toThrow(/reserved/);
  });
});

describe("paths", () => {
  test("get and set", () => {
    const value = { a: { b: [{ c: 1 }] } };
    expect(getPath(value, "a.b.0.c")).toBe(1);
    expect(getPath(value, "a.x.y")).toBeUndefined();
    const next = setPath(value, "a.b.0.c", 2);
    expect(next).toEqual({ a: { b: [{ c: 2 }] } });
    // - immutable: original untouched, copies along the path
    expect(value.a.b[0]?.c).toBe(1);
    expect(Array.isArray(next.a.b)).toBe(true);
    expect(setPath({}, "x.y", 1)).toEqual({ x: { y: 1 } });
  });
});

describe("validate", () => {
  test("flattens issues to dot paths", async () => {
    const result = await validate(schema, { name: "", newsletter: false, email: "", kind: "person", addresses: [{ street: 1 }] });
    expect(result.errors?.name).toBe("Required");
    expect(Object.keys(result.errors ?? {})).toContain("addresses.0.street");
  });

  test("returns the output on success", async () => {
    const input = { name: "A", newsletter: false, email: "", kind: "person", addresses: [] };
    expect(await validate(schema, input)).toEqual({ value: input });
  });
});
