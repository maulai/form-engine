import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createController, type ErrorAdapter, type FieldView, type View } from "../src/core";
import { form, kinds } from "./kit";

const schema = z.object({
  name: z.string().min(1, "Name required"),
  email: z.string().regex(/@/, "Invalid e-mail").or(z.literal("")),
  kind: z.enum(["person", "company"]),
  company: z.string(),
  currency: z.string(),
  items: z.array(z.object({ title: z.string().min(1, "Title required"), qty: z.number(), total: z.number() })),
});
type Values = z.infer<typeof schema>;
const blank: Values = { name: "", email: "", kind: "person", company: "", currency: "EUR", items: [] };

const visible = (view: View): FieldView[] => view.panels.flatMap((p) => p.sections.flatMap((s) => s.fields));
const keys = (view: View) => visible(view).map((f) => f.key);
/** Let pending validations (async by contract) finish. */
const tick = () => new Promise((r) => setTimeout(r, 0));

const contact = form(schema)
  .props<{ currency?: string }>()
  .define((f) => ({
    defaults: (value: Values | undefined) => value ?? blank,
    sections: [
      {
        fields: {
          name: f.text("Name").lockedOnEdit(),
          email: f.text("E-mail"),
          kind: f.select("Kind", ["person", "company"]),
          company: f.text("Company").if("kind", "company"),
          currency: f.select("Currency", ["EUR", "USD"]).fixed(({ props }) => props.currency),
          items: f.rows((r) => ({
            title: r.text("Title"),
            qty: r.number("Qty").onChange((qty, { set, args }) => set("total", (qty ?? 0) * 2 + args.index)),
          })),
        },
      },
    ],
  }));

function setup(options: { action?: (input: Values) => unknown; errors?: ErrorAdapter; value?: Values; props?: object } = {}) {
  const action = vi.fn(options.action ?? (async (input: Values) => ({ id: 1, ...input })));
  const onSuccess = vi.fn();
  const c = createController({ definition: contact, kinds, action, onSuccess, ...(options.errors && { errors: options.errors }) });
  c.open({ value: options.value, props: options.props ?? {} });
  return { c, action, onSuccess, values: () => c.store.getState().values as Values, errors: () => c.store.getState().errors };
}

describe("open", () => {
  test("defaults, fixed values applied without making the form dirty", () => {
    const { c, values } = setup({ props: { currency: "USD" } });
    expect(values()).toMatchObject({ name: "", currency: "USD" });
    expect(c.store.isDirty()).toBe(false);
    const currency = visible(c.getState().view).find((f) => f.key === "currency");
    expect(currency?.readOnly).toBe(true);
  });

  test("edit mode from the record", () => {
    const { c } = setup({ value: { ...blank, name: "Ada" } });
    expect(c.getState().edit).toBe(true);
    expect(visible(c.getState().view).find((f) => f.key === "name")?.readOnly).toBe(true);
  });

  test("setContext re-evaluates fixed values", () => {
    const { c, values } = setup();
    expect(values().currency).toBe("EUR");
    c.setContext({ props: { currency: "USD" } });
    expect(values().currency).toBe("USD");
  });
});

describe("validation timing", () => {
  test("nothing before the first submit, everything on submit", async () => {
    const { c, errors, action } = setup();
    c.change("email", "nope");
    c.blur("email");
    await tick();
    expect(errors()).toEqual({});

    const outcome = await c.submit();
    expect(outcome.status).toBe("invalid");
    expect(action).not.toHaveBeenCalled();
    expect(errors()).toEqual({ name: "Name required", email: "Invalid e-mail" });
    // - focus goes to the first invalid field in form order
    expect(c.getState().focus).toEqual({ path: "name", seq: 1 });
  });

  test("after a submit: fixed errors disappear while typing, new ones only on blur", async () => {
    const { c, errors } = setup();
    c.change("email", "nope");
    await c.submit();
    expect(errors()).toEqual({ name: "Name required", email: "Invalid e-mail" });
    c.change("name", "Ada");
    await tick();
    expect(errors()).toEqual({ email: "Invalid e-mail" });

    c.change("email", "");
    await tick();
    expect(errors()).toEqual({});

    c.change("email", "still wrong");
    await tick();
    expect(errors()).toEqual({});
    c.blur("email");
    await tick();
    expect(errors()).toEqual({ email: "Invalid e-mail" });
  });
});

describe("rules while editing", () => {
  test("hidden after being seen → emptied", () => {
    const { c, values } = setup();
    c.change("kind", "company");
    expect(keys(c.getState().view)).toContain("company");
    c.change("company", "ACME");
    c.change("kind", "person");
    expect(values().company).toBe("");
  });

  test("onChange effects run with row-relative paths and row args", () => {
    const { c, values } = setup();
    c.rows.append("items", { title: "a", qty: 0, total: 0 });
    c.rows.append("items", { title: "b", qty: 0, total: 0 });
    c.change("items.1.qty", 5);
    expect(values().items[1]).toEqual({ title: "b", qty: 5, total: 11 });
    // - code writing the store directly is not a user change: no effect
    c.store.set("items.0.qty", 3);
    expect(values().items[0]?.total).toBe(0);
  });
});

describe("submit", () => {
  const valid: Values = { ...blank, name: "Ada" };

  test("success calls the action and onSuccess with its result", async () => {
    const { c, action, onSuccess } = setup({ value: valid });
    const outcome = await c.submit();
    expect(outcome).toEqual({ status: "success", result: { id: 1, ...valid } });
    expect(action).toHaveBeenCalledWith(valid);
    expect(onSuccess).toHaveBeenCalledWith({ id: 1, ...valid });
    expect(c.getState().saves).toBe(1);
  });

  test("hidden values go out emptied, never-shown defaults go out kept", async () => {
    const { c, action } = setup({ value: valid });
    await c.submit();
    expect(action.mock.calls[0]?.[0]).toMatchObject({ company: "", currency: "EUR" });
  });

  test("server errors: at the field when visible, else in the summary", async () => {
    const errors: ErrorAdapter = () => ({ message: "Rejected", fields: { email: "Taken", company: "Not here" } });
    const { c } = setup({ value: valid, errors, action: async () => Promise.reject(new Error("x")) });
    const outcome = await c.submit();
    expect(outcome.status).toBe("failed");
    expect(c.store.getState().errors).toMatchObject({ email: "Taken" });
    expect(c.getState().summary).toEqual(["Not here", "Rejected"]);
    expect(c.getState().focus?.path).toBe("email");
  });

  test("confirm: shown, retried, cleared", async () => {
    const calls: Values[] = [];
    const errors: ErrorAdapter = () => ({ confirm: { message: "Sure?", retry: (input: Values) => ({ ...input, company: "forced" }) } });
    const { c, onSuccess } = setup({
      value: valid,
      errors,
      action: async (input) => {
        calls.push(input);
        if (input.company !== "forced") throw new Error("confirm");
        return "ok";
      },
    });
    expect((await c.submit()).status).toBe("confirm");
    expect(c.getState().confirm?.message).toBe("Sure?");
    expect(await c.confirm()).toEqual({ status: "success", result: "ok" });
    expect(c.getState().confirm).toBeUndefined();
    expect(onSuccess).toHaveBeenCalledWith("ok");
    expect(calls.map((v) => v.company)).toEqual(["", "forced"]);
  });

  test("pending is published while saving", async () => {
    let release: (() => void) | undefined;
    const { c } = setup({ value: valid, action: () => new Promise<void>((r) => (release = r)) });
    const done = c.submit();
    expect(c.getState().pending).toBe(true);
    // - the action starts after the (async) validation
    await vi.waitFor(() => expect(release).toBeDefined());
    release!();
    await done;
    expect(c.getState().pending).toBe(false);
  });
});

describe("panels", () => {
  const paneled = form(schema, (f) => ({
    panels: [
      { name: "A", sections: [{ fields: { email: f.text("E-mail") } }] },
      { name: "B", sections: [{ fields: { name: f.text("Name") } }] },
    ],
  }));

  test("a failed submit opens the panel of the first error and marks it", async () => {
    const c = createController({ definition: paneled, kinds, action: vi.fn() });
    c.open({ value: blank });
    expect(c.getState().activePanel).toBe(0);
    await c.submit();
    expect(c.getState().activePanel).toBe(1);
    expect([...c.getState().errorPanels]).toEqual([1]);
    expect(c.getState().focus?.path).toBe("name");
  });
});

describe("autosave", () => {
  afterEach(() => vi.useRealTimers());

  const settings = form(schema, (f) => ({
    autosave: 100,
    sections: [{ fields: { name: f.text("Name"), email: f.text("E-mail") } }],
  }));

  test("saves valid changes after the delay, shows errors live, flushes on dispose", async () => {
    vi.useFakeTimers();
    const action = vi.fn(async () => "ok");
    const c = createController({ definition: settings, kinds, action });
    c.open({ value: { ...blank, name: "Ada" } });

    c.change("name", "Ada L");
    c.change("name", "Ada Lovelace");
    await vi.advanceTimersByTimeAsync(100);
    expect(action).toHaveBeenCalledOnce();
    expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Ada Lovelace" }));

    // - invalid: no save, the error shows while typing
    c.change("email", "x");
    await vi.advanceTimersByTimeAsync(100);
    expect(action).toHaveBeenCalledOnce();
    expect(c.store.getState().errors).toEqual({ email: "Invalid e-mail" });

    c.change("email", "a@b");
    c.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(action).toHaveBeenCalledTimes(2);
  });
});
