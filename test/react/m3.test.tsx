// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { useFormDialog } from "../../src/react";
import { form } from "./html-kit";

afterEach(cleanup);

type Product = { id: string; name: string; price: number };
const products: Product[] = [
  { id: "p1", name: "Apple", price: 2 },
  { id: "p2", name: "Pear", price: 3 },
];

const order = z.object({
  supplier: z.string(),
  lines: z.array(z.object({ product_id: z.string(), title: z.string(), qty: z.number().nullable(), price: z.number().nullable() })),
});
type Order = z.infer<typeof order>;
const empty: Order = { supplier: "", lines: [] };

const total = (o: Order) => o.lines.reduce((s, l) => s + (l.qty ?? 0) * (l.price ?? 0), 0);

const OrderForm = form(order)
  .props<{ placement?: "sidebar" | "inline" }>()
  .context(() => ({ products }))
  .define((f) => ({
    title: "Order",
    defaults: (value: Order | undefined) => value ?? empty,
    sections: [
      {
        fields: {
          supplier: f.text("Supplier"),
          lines: f.rows((r) => ({ title: r.text("Title"), qty: r.number("Qty") }), {
            picker: f.picker({
              items: ({ ctx }) => ctx.products,
              key: (p) => p.id,
              label: (p) => p.name,
              toRow: (p) => ({ product_id: p.id, title: p.name, qty: 1, price: p.price }),
              unique: "product_id",
              disabled: ({ values }) => !values.supplier,
              custom: { label: "Custom line", row: () => ({ product_id: "", title: "Custom", price: 0 }) },
            }),
            removable: ({ row }) => row.title !== "locked",
            summary: ({ values }) => `Total ${total(values)}`,
          }),
        },
      },
    ],
  }));

describe("picker", () => {
  test("disabled until the condition holds, picks become rows, unique items disable", async () => {
    const action = vi.fn(async (v: Order) => v);
    render(<OrderForm inline action={action} />);
    const picker = () => screen.getByRole("listbox", { name: "picker inline" });
    expect(within(picker()).getByRole("option", { name: "Apple" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "ACME" } });
    fireEvent.click(within(picker()).getByRole("option", { name: "Apple" }));
    expect((screen.getAllByLabelText("Title") as HTMLInputElement[]).map((i) => i.value)).toEqual(["Apple"]);
    // - already in the list
    expect(within(picker()).getByRole("option", { name: "Apple" }).hasAttribute("disabled")).toBe(true);
    expect(within(picker()).getByRole("option", { name: "Pear" }).hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Custom line" }));
    expect(screen.getByText("Total 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0]?.[0].lines).toEqual([
      { product_id: "p1", title: "Apple", qty: 1, price: 2 },
      // - columns the row does not set (qty) get their empty value
      { product_id: "", title: "Custom", qty: null, price: 0 },
    ]);
  });

  test("sidebar placement renders the picker in the dialog's left column", () => {
    const SidebarForm = form(order)
      .context(() => ({ products }))
      .define((f) => ({
        sections: [
          {
            fields: {
              lines: f.rows((r) => ({ title: r.text("Title") }), {
                picker: f.picker({
                  items: ({ ctx }) => ctx.products,
                  key: (p) => p.id,
                  label: (p) => p.name,
                  toRow: (p) => ({ product_id: p.id, title: p.name }),
                  placement: "sidebar",
                }),
              }),
            },
          },
        ],
      }));
    render(<SidebarForm open action={vi.fn()} />);
    const aside = screen.getByRole("dialog").querySelector("aside")!;
    expect(within(aside).getByRole("listbox", { name: "picker sidebar" })).toBeTruthy();
    fireEvent.click(within(aside).getByRole("option", { name: "Pear" }));
    expect((screen.getAllByLabelText("Title") as HTMLInputElement[]).map((i) => i.value)).toEqual(["Pear"]);
  });
});

describe("rows", () => {
  test("removable reacts to the row's own value", () => {
    render(<OrderForm inline action={vi.fn()} value={{ supplier: "x", lines: [{ product_id: "", title: "locked", qty: 1, price: 1 }] }} />);
    expect(screen.queryByRole("button", { name: "Remove 0" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "free" } });
    expect(screen.getByRole("button", { name: "Remove 0" })).toBeTruthy();
  });

  test("summary follows the values", () => {
    render(<OrderForm inline action={vi.fn()} value={{ supplier: "x", lines: [{ product_id: "p1", title: "A", qty: 2, price: 3 }] }} />);
    expect(screen.getByText("Total 6")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Qty"), { target: { value: "4" } });
    expect(screen.getByText("Total 12")).toBeTruthy();
  });
});

describe("single option", () => {
  const s = z.object({ company: z.string(), name: z.string() });
  const SingleForm = form(s)
    .props<{ companies: readonly string[] }>()
    .define((f) => ({
      title: "Single",
      sections: [{ fields: { company: f.select("Company", ["only"]), name: f.text("Name") } }],
    }));

  test("is selected, read-only, and does not make the form dirty", async () => {
    const action = vi.fn(async (v: unknown) => v);
    render(<SingleForm open action={action} companies={["only"]} />);
    const select = screen.getByLabelText("Company") as HTMLSelectElement;
    expect(select.value).toBe("only");
    expect(select.disabled).toBe(true);
    // - closing without edits asks nothing
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("loading", () => {
  const s = z.object({ owner: z.string() });

  test("pending prop: placeholders, no submit, then a session with the full data", () => {
    const Owned = form(s)
      .props<{ defaultOwner: string }>()
      .define((f) => ({
        defaults: (_v, { props }) => ({ owner: props.defaultOwner }),
        sections: [{ fields: { owner: f.text("Owner") } }],
      }));
    const { rerender } = render(<Owned open pending action={vi.fn()} defaultOwner="" />);
    expect(screen.getByRole("status").textContent).toBe("Loading");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Owned open action={vi.fn()} defaultOwner="Ada" />);
    expect((screen.getByLabelText("Owner") as HTMLInputElement).value).toBe("Ada");
  });

  test("a context hook returning undefined loads first", () => {
    let data: { owner: string } | undefined;
    const Loaded = form(s)
      .context(() => data)
      .define((f) => ({
        defaults: (_v, { ctx }) => ({ owner: ctx.owner }),
        sections: [{ fields: { owner: f.text("Owner") } }],
      }));
    const { rerender } = render(<Loaded inline action={vi.fn()} />);
    expect(screen.getByRole("status")).toBeTruthy();
    data = { owner: "Grace" };
    rerender(<Loaded inline action={vi.fn()} />);
    expect((screen.getByLabelText("Owner") as HTMLInputElement).value).toBe("Grace");
  });
});

describe("useFormDialog", () => {
  const s = z.object({ name: z.string().min(1) });
  const TagForm = form(s, (f) => ({ title: "Tag", sections: [{ fields: { name: f.text("Name") } }] }));

  function Table({ action }: { action: (v: { name: string }) => unknown }) {
    const [tags] = useState([{ name: "red" }, { name: "blue" }]);
    const edit = useFormDialog(TagForm, { action });
    return (
      <>
        {tags.map((t) => (
          <button key={t.name} type="button" onClick={() => edit.open(t)}>
            Edit {t.name}
          </button>
        ))}
        {edit.element}
      </>
    );
  }

  test("one dialog per click, fresh each time, closes after saving", async () => {
    const action = vi.fn(async (v: { name: string }) => v);
    render(<Table action={action} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit red" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("red");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "crimson" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(action).toHaveBeenCalledWith({ name: "crimson" });

    fireEvent.click(screen.getByRole("button", { name: "Edit blue" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("blue");
  });
});
