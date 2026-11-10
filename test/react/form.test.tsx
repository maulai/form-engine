// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { useField, type FieldProps } from "../../src/react";
import { form, renders } from "./html-kit";

afterEach(cleanup);
beforeEach(() => renders.clear());

const schema = z.object({
  name: z.string().min(1, "Name required"),
  newsletter: z.boolean(),
  email: z.string(),
  kind: z.enum(["person", "company"]),
  company: z.string(),
});
type Values = z.infer<typeof schema>;
const blank: Values = { name: "", newsletter: false, email: "", kind: "person", company: "" };

const ContactForm = form(schema, (f) => ({
  title: "Contact",
  defaults: (value: Values | undefined) => value ?? blank,
  sections: [
    {
      name: "General",
      fields: {
        name: f.text("Name"),
        newsletter: f.checkbox("Newsletter"),
        email: f.text("E-mail").if("newsletter").hint("Never shared"),
        kind: f.select("Kind", ["person", "company"]),
        company: f.text("Company").if("kind", "company"),
      },
    },
  ],
}));

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });

describe("inline", () => {
  test("renders, reacts to conditions, submits the values", async () => {
    const action = vi.fn(async (v: Values) => v);
    render(<ContactForm inline action={action} />);
    expect(screen.queryByLabelText("E-mail")).toBeNull();

    type("Name", "Ada");
    fireEvent.click(input("Newsletter"));
    expect(screen.getByText("Never shared")).toBeTruthy();
    type("E-mail", "ada@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action).toHaveBeenCalledWith({ ...blank, name: "Ada", newsletter: true, email: "ada@example.com" });
  });

  test("invalid submit shows errors at the field and focuses it", async () => {
    render(<ContactForm inline action={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Name required"));
    await waitFor(() => expect(document.activeElement).toBe(input("Name")));
    expect(input("Name").getAttribute("aria-invalid")).toBe("true");
  });

  test("hidden after being seen → emptied", async () => {
    const action = vi.fn(async (v: Values) => v);
    render(<ContactForm inline action={action} value={{ ...blank, name: "Ada" }} />);
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "company" } });
    type("Company", "ACME");
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "person" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith(expect.objectContaining({ company: "", kind: "person" })));
  });

  test("typing re-renders the edited field only", () => {
    render(<ContactForm inline action={vi.fn()} />);
    const id = input("Name").id;
    const company = [...renders.keys()].find((k) => k !== id)!;
    const before = renders.get(company);
    type("Name", "A");
    type("Name", "Ad");
    expect(renders.get(id)).toBeGreaterThan(1);
    expect(renders.get(company)).toBe(before);
  });
});

describe("dialog", () => {
  test("trigger opens, success closes and reports the result", async () => {
    const onSuccess = vi.fn();
    render(<ContactForm trigger={<button type="button">New</button>} action={async (v) => ({ id: 7, ...v })} onSuccess={onSuccess} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByRole("dialog", { name: "Contact" })).toBeTruthy();
    type("Name", "Ada");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 7, name: "Ada" }));
  });

  test("reopening starts fresh", async () => {
    render(<ContactForm trigger={<button type="button">New</button>} action={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    type("Name", "draft");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    // - dirty: the engine asks before discarding
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(input("Name").value).toBe("");
  });

  test("keep editing cancels the close", () => {
    render(<ContactForm trigger={<button type="button">New</button>} action={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    type("Name", "draft");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(input("Name").value).toBe("draft");
  });

  test("controlled open", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<ContactForm open={false} onOpenChange={onOpenChange} action={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<ContactForm open onOpenChange={onOpenChange} action={vi.fn()} value={{ ...blank, name: "Ada" }} />);
    expect(input("Name").value).toBe("Ada");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("server errors and confirm", () => {
  test("field errors at the field, the rest in the summary", async () => {
    const Form = form(schema, (f) => ({
      sections: [{ fields: { name: f.text("Name"), email: f.text("E-mail") } }],
    }));
    const failing = async () => {
      throw Object.assign(new Error("Rejected"), { fields: { email: "Taken" } });
    };
    // - default adapter: message only; a kit adapter would map `fields`
    render(<Form inline action={failing} value={{ ...blank, name: "Ada" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByLabelText("summary").textContent).toBe("Rejected"));
  });
});

describe("panels", () => {
  const Paneled = form(schema, (f) => ({
    panels: [
      { name: "General", sections: [{ fields: { name: f.text("Name") } }] },
      { name: "Contact", sections: [{ fields: { email: f.text("E-mail") } }] },
    ],
  }));

  test("navigation switches panels and keeps values", () => {
    render(<Paneled inline action={vi.fn()} />);
    type("Name", "Ada");
    fireEvent.click(screen.getByRole("button", { name: "Contact" }));
    expect(screen.queryByLabelText("Name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(input("Name").value).toBe("Ada");
  });

  test("a failed submit opens the panel with the error and marks it", async () => {
    render(<Paneled inline action={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Contact" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
    expect(screen.getByRole("button", { name: "General" }).getAttribute("data-invalid")).toBe("true");
  });
});

describe("rows", () => {
  const listSchema = z.object({ items: z.array(z.object({ title: z.string().min(1, "Title required"), qty: z.number().nullable() })) });
  const ListForm = form(listSchema, (f) => ({
    sections: [{ fields: { items: f.rows((r) => ({ title: r.text("Title"), qty: r.number("Qty") }), { add: "Add item" }) } }],
  }));

  test("add, edit, remove keep row identity", async () => {
    const action = vi.fn(async (v: unknown) => v);
    render(<ListForm inline action={action} value={{ items: [{ title: "a", qty: 1 }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const titles = () => screen.getAllByLabelText("Title") as HTMLInputElement[];
    expect(titles()).toHaveLength(2);
    fireEvent.change(titles()[1]!, { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove 0" }));
    expect(titles().map((t) => t.value)).toEqual(["b"]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith({ items: [{ title: "b", qty: null }] }));
  });

  test("row errors show at their cell", async () => {
    render(<ListForm inline action={vi.fn()} value={{ items: [{ title: "", qty: 1 }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Title required"));
  });
});

describe("custom fields", () => {
  test("f.custom gets the field api", async () => {
    function Stepper({ id }: FieldProps<unknown, unknown>) {
      const field = useField<number | null>();
      return (
        <button type="button" id={id} onClick={() => field.set((field.value ?? 0) + 1)}>
          Count {field.value ?? 0}
        </button>
      );
    }
    const s = z.object({ count: z.number().nullable() });
    const Counter = form(s, (f) => ({ sections: [{ fields: { count: f.custom<number | null>(Stepper) } }] }));
    const action = vi.fn(async (v: unknown) => v);
    render(<Counter inline action={action} value={{ count: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Count 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Count 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith({ count: 3 }));
  });
});

describe("autosave", () => {
  afterEach(() => vi.useRealTimers());

  test("saves after the debounce and on unmount", async () => {
    vi.useFakeTimers();
    const Settings = form(schema, (f) => ({ autosave: 100, sections: [{ fields: { name: f.text("Name") } }] }));
    const action = vi.fn(async (v: unknown) => v);
    const { unmount } = render(<Settings inline action={action} value={{ ...blank, name: "Ada" }} />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    type("Name", "Ada L");
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(action).toHaveBeenCalledOnce();

    type("Name", "Ada Lovelace");
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(action).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Ada Lovelace" }));
  });
});

describe("discard confirm", () => {
  test("renders inside the form dialog and ignores close requests while it is open", () => {
    render(<ContactForm trigger={<button type="button">New</button>} action={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    type("Name", "draft");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const confirm = screen.getByRole("alertdialog");
    // - nested in the React (and here DOM) tree of the form dialog: libraries see it as a nested layer
    expect(screen.getByRole("dialog").contains(confirm)).toBe(true);

    // - a stray close request from the form dialog (focus or click moving into the confirm)
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(input("Name").value).toBe("draft");
  });
});
