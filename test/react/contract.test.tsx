// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { controlProps, createFormKit, kind, type FieldProps } from "../../src/react";
import { form, kinds, layout } from "./html-kit";

afterEach(cleanup);

describe("what the kit gets, ready to render", () => {
  test("hints are always objects", () => {
    const s = z.object({ a: z.string(), b: z.string() });
    const F = form(s, (f) => ({ sections: [{ fields: { a: f.text("A").hint("plain"), b: f.text("B").hint({ text: "toned", tone: "warning" }) } }] }));
    render(<F inline action={vi.fn()} />);
    expect(screen.getByText("plain").tagName).toBe("SMALL");
    expect(screen.getByText("toned").getAttribute("data-tone")).toBe("warning");
  });

  test("panel status is normalised; an error wins with the kit's hint", async () => {
    const s = z.object({ a: z.string().min(1), b: z.string() });
    const F = form(s, (f) => ({
      panels: [
        { name: "A", status: ({ values }) => (values.a ? "complete" : "empty"), sections: [{ fields: { a: f.text("A") } }] },
        { name: "B", status: () => ({ state: "incomplete", hint: "later" }), sections: [{ fields: { b: f.text("B") } }] },
      ],
    }));
    render(<F inline action={vi.fn()} />);
    const tab = (name: string) => screen.getByRole("button", { name });
    expect([tab("A").getAttribute("data-tone"), tab("B").getAttribute("data-tone"), tab("B").title]).toEqual(["neutral", "warning", "later"]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(tab("A").getAttribute("data-tone")).toBe("danger"));
    expect(tab("A").title).toBe("Check the highlighted fields");
  });

  test("labelInside: the frame gets no label, the component does", () => {
    function Check(props: FieldProps<boolean>) {
      return (
        <label>
          <input type="checkbox" {...controlProps(props)} checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />
          {props.label}
        </label>
      );
    }
    const { form: f2 } = createFormKit({ kinds: { ...kinds, check: kind(Check, { empty: false, labelInside: true }) }, layout });
    const s = z.object({ ok: z.boolean() });
    const F = f2(s, (f) => ({ sections: [{ fields: { ok: f.check("Agree") } }] }));
    render(<F inline action={vi.fn()} />);
    expect(screen.getAllByText("Agree")).toHaveLength(1);
    expect(screen.getByLabelText("Agree")).toBeTruthy();
  });

  test("cells know their place: no label in a table", () => {
    const s = z.object({ a: z.string(), rows: z.array(z.object({ x: z.string() })) });
    const F = form(s, (f) => ({
      sections: [{ fields: { a: f.text("A"), rows: f.rows((r) => ({ x: r.text("X") }), { as: "table" }) } }],
    }));
    render(<F inline action={vi.fn()} value={{ a: "", rows: [{ x: "" }] }} />);
    expect(screen.getByLabelText("A").closest("[data-place]")?.getAttribute("data-place")).toBe("form");
    expect(screen.queryByText("X")).toBeNull();
    expect(document.querySelectorAll('[data-place="row"]')).toHaveLength(1);
  });
});
