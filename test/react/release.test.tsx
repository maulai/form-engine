// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { useFormApi } from "../../src/react";
import { form } from "./html-kit";

afterEach(cleanup);

const s = z.object({ name: z.string(), lines: z.array(z.object({ x: z.string() })) });
type V = z.infer<typeof s>;
const value: V = { name: "Ada", lines: [{ x: "a" }] };

describe("read-only view", () => {
  const F = form(s, (f) => ({
    sections: [{ fields: { name: f.text("Name"), lines: f.rows((r) => ({ x: r.text("X") }), { add: "Add" }) } }],
  }));

  test("every field read-only, no submit, no list editing", () => {
    render(<F inline readOnly value={value} action={vi.fn()} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText("X") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove 0" })).toBeNull();
  });

  test("switching to edit starts a fresh, editable session", () => {
    const { rerender } = render(<F inline readOnly value={value} action={vi.fn()} />);
    rerender(<F inline value={value} action={vi.fn()} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).readOnly).toBe(false);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});

describe("useFormApi: reset and busy", () => {
  test("reset goes back to the opened values", () => {
    function Reset() {
      const api = useFormApi();
      return (
        <button type="button" onClick={api.reset}>
          Reset
        </button>
      );
    }
    const F = form(s, (f) => ({ sections: [{ fields: { name: f.text("Name") }, after: <Reset /> }] }));
    render(<F inline value={value} action={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Grace" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Ada");
  });

  test("busy blocks submit until the work settles", async () => {
    let finish!: () => void;
    function Upload() {
      const api = useFormApi();
      return (
        <button type="button" onClick={() => void api.busy(new Promise<void>((r) => (finish = r)))}>
          Upload
        </button>
      );
    }
    const action = vi.fn(async (v: unknown) => v);
    const F = form(s, (f) => ({ sections: [{ fields: { name: f.text("Name") }, after: <Upload /> }] }));
    render(<F inline value={value} action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    // - Ctrl+Enter does not get around it
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter", ctrlKey: true });
    await act(async () => finish());
    expect(save().disabled).toBe(false);
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(save());
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
  });
});

describe("leaving the page", () => {
  test("asks only while there are unsaved changes", () => {
    const F = form(s, (f) => ({ sections: [{ fields: { name: f.text("Name") } }] }));
    render(<F inline value={value} action={vi.fn()} />);
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Grace" } });
    expect(leave()).toBe(true);
  });
});
