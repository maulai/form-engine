// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createFormKit, useArgs, type FieldProps } from "../../src/react";
import { form, kinds, layout } from "./html-kit";

afterEach(cleanup);

const order = z.object({
  mode: z.enum(["normal", "special"]),
  force: z.boolean(),
  items: z.array(z.object({ title: z.string(), sources: z.array(z.object({ qty: z.number().nullable(), place: z.string() })) })),
});
type Order = z.infer<typeof order>;

describe("useArgs", () => {
  test("a custom cell in a nested list reads its row and parent", () => {
    function Badge({ id }: FieldProps<unknown, unknown>) {
      const label = useArgs<{ values: unknown; ctx: unknown; props: unknown; edit: boolean; row: { qty: number | null }; parent: { title: string }; index: number }, string>(
        ({ row, parent, index }) => `${parent.title}/${index}: ${row.qty}`,
      );
      return <output id={id}>{label}</output>;
    }
    const Form = form(order, (f) => ({
      sections: [
        { fields: { items: f.rows((r) => ({ title: r.text("Title"), sources: r.rows((s) => ({ qty: s.number("Qty"), place: s.custom(Badge) })) })) } },
      ],
    }));
    render(<Form inline action={vi.fn()} value={{ mode: "normal", force: false, items: [{ title: "A", sources: [{ qty: 1, place: "" }] }] }} />);
    expect(screen.getByText("A/0: 1")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Qty"), { target: { value: "7" } });
    expect(screen.getByText("B/0: 7")).toBeTruthy();
  });
});

describe("dynamic options", () => {
  test("options follow other values; a single option is selected and read-only", () => {
    const s = z.object({ country: z.string(), city: z.string() });
    const cities: Record<string, string[]> = { DE: ["Berlin", "Hamburg"], LU: ["Luxembourg"] };
    const Form = form(s, (f) => ({
      sections: [
        {
          fields: {
            country: f.select("Country", ["DE", "LU"]),
            city: f.select("City", []).config(({ values }) => ({ options: cities[values.country] ?? [] })),
          },
        },
      ],
    }));
    render(<Form inline action={vi.fn()} value={{ country: "DE", city: "" }} />);
    const city = () => screen.getByLabelText("City") as HTMLSelectElement;
    expect(Array.from(city().options, (o) => o.value)).toEqual(["", "Berlin", "Hamburg"]);
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "LU" } });
    expect(city().value).toBe("Luxembourg");
    expect(city().disabled).toBe(true);
  });
});

describe("picker and add per case", () => {
  const Lines = form(order)
    .props<{ special: boolean }>()
    .define((f) => {
      const titles = f.picker({ items: () => ["Apple"], key: (t) => t, label: (t) => t, toRow: (t) => ({ title: t, sources: [] }) });
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

  test("normal: picker, no button; special: button, no picker", () => {
    const { rerender } = render(<Lines inline action={vi.fn()} special={false} value={{ mode: "normal", force: false, items: [] }} />);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Special line" })).toBeNull();
    rerender(<Lines inline action={vi.fn()} special value={{ mode: "normal", force: false, items: [] }} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Special line" }));
    expect(screen.getAllByLabelText("Title")).toHaveLength(1);
  });
});

describe("confirm per form", () => {
  test("the dialog uses the form's wording and its retry", async () => {
    const { form: confirmingForm } = createFormKit({
      kinds,
      layout,
      errors: (e) => ((e as Error).message === "confirm" ? { confirm: { message: "Stock goes negative." } } : { message: String(e) }),
    });
    const Booking = confirmingForm(order, (f) => ({
      confirm: { retry: (data) => ({ ...data, force: true }), title: "Book anyway?", action: "Book" },
      sections: [{ fields: { mode: f.select("Mode", ["normal", "special"]) } }],
    }));
    const action = vi.fn(async (input: Order) => {
      if (!input.force) throw new Error("confirm");
      return "ok";
    });
    render(<Booking inline action={action} value={{ mode: "normal", force: false, items: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Book anyway?" });
    expect(dialog.textContent).toContain("Stock goes negative.");
    fireEvent.click(screen.getByRole("button", { name: "Book" }));
    await waitFor(() => expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ force: true })));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("content columns in the UI", () => {
  test("a total cell updates and new rows get no value for it", async () => {
    const s = z.object({ items: z.array(z.object({ qty: z.number().nullable() })) });
    const Lines = form(s, (f) => ({
      sections: [{ fields: { items: f.rows((r) => ({ qty: r.number("Qty"), total: r.display(({ row }) => `Total ${(row.qty ?? 0) * 10}`) }), { add: "Add" }) } }],
    }));
    const action = vi.fn(async (v: unknown) => v);
    render(<Lines inline action={action} value={{ items: [{ qty: 1 }] }} />);
    expect(screen.getByText("Total 10")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Qty"), { target: { value: "3" } });
    expect(screen.getByText("Total 30")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith({ items: [{ qty: 3 }, { qty: null }] }));
  });
});

describe("typed hooks and size", () => {
  const s = z.object({ brand: z.string(), lines: z.array(z.object({ name: z.string() })) });

  test("Form.useValues / useRowArgs in a custom cell", () => {
    function Cell() {
      const brand = Lines.useValues((v) => v.brand);
      const label = Lines.useRowArgs("lines", ({ row, index }) => `${brand}:${index}:${row.name}`);
      return <output>{label}</output>;
    }
    const Lines = form(s, (f) => ({
      sections: [{ fields: { brand: f.text("Brand"), lines: f.rows((r) => ({ name: r.text("Name"), info: r.display(() => <Cell />) })) } }],
    }));
    render(<Lines inline action={vi.fn()} value={{ brand: "acme", lines: [{ name: "a" }] }} />);
    expect(screen.getByText("acme:0:a")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "beta" } });
    expect(screen.getByText("beta:0:a")).toBeTruthy();
  });

  test("a sidebar picker makes the dialog wide", () => {
    const Picked = form(s, (f) => {
      const names = f.picker("lines", { items: () => ["x"], key: (n) => n, label: (n) => n, toRow: (n) => ({ name: n }), placement: "sidebar" });
      return { sections: [{ fields: { lines: f.rows((r) => ({ name: r.text("Name") }), { picker: names }) } }] };
    });
    render(<Picked open action={vi.fn()} />);
    expect(screen.getByRole("dialog").getAttribute("data-size")).toBe("xl");
  });
});

describe("unique in the UI", () => {
  test("taken values leave the other rows, add picks the next free one and stops at the end", () => {
    const s = z.object({ lines: z.array(z.object({ place: z.string() })) });
    const Places = form(s, (f) => ({
      sections: [{ fields: { lines: f.rows((r) => ({ place: r.select("Place", ["a", "b"]).unique() }), { add: "Add" }) } }],
    }));
    render(<Places inline action={vi.fn()} value={{ lines: [{ place: "a" }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const selects = () => screen.getAllByLabelText("Place") as HTMLSelectElement[];
    // - the new row got "b"; row 0 no longer offers it (only one option left → read-only)
    expect(selects().map((x) => x.value)).toEqual(["a", "b"]);
    expect(Array.from(selects()[0]!.options, (o) => o.value)).toEqual(["", "a"]);
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });
});
