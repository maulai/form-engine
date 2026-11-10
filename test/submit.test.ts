import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createAutosave, createSubmitter, type ErrorAdapter } from "../src/core";

const schema = z.object({ name: z.string().min(1, "Required"), force: z.boolean().optional() });

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe("submitter", () => {
  test("invalid values never reach the action", async () => {
    const action = vi.fn();
    const s = createSubmitter({ schema, action });
    expect(await s.submit({ name: "" })).toEqual({ status: "invalid", errors: { name: "Required" } });
    expect(action).not.toHaveBeenCalled();
  });

  test("success returns the action result", async () => {
    const s = createSubmitter({ schema, action: async (input) => ({ id: 1, ...input }) });
    expect(await s.submit({ name: "A" })).toEqual({ status: "success", result: { id: 1, name: "A" } });
  });

  test("toInput maps or cancels", async () => {
    const action = vi.fn(async (input: { label: string }) => input.label);
    const mapped = createSubmitter({ schema, toInput: (d) => ({ label: d.name.toUpperCase() }), action });
    expect(await mapped.submit({ name: "a" })).toEqual({ status: "success", result: "A" });
    const cancelled = createSubmitter({ schema, toInput: () => null, action });
    expect(await cancelled.submit({ name: "a" })).toEqual({ status: "cancelled" });
  });

  test("errors go through the adapter", async () => {
    const errors: ErrorAdapter = (e) => ({ message: "Rejected", fields: { name: String((e as Error).message) } });
    const s = createSubmitter({ schema, errors, action: async () => Promise.reject(new Error("Taken")) });
    expect(await s.submit({ name: "A" })).toEqual({ status: "failed", error: { message: "Rejected", fields: { name: "Taken" } } });
  });

  test("adapter returning null means handled", async () => {
    const s = createSubmitter({ schema, errors: () => null, action: async () => Promise.reject(new Error("x")) });
    expect(await s.submit({ name: "A" })).toEqual({ status: "cancelled" });
  });

  test("an adapter that throws rejects the submit and frees the queue", async () => {
    let fail = true;
    const s = createSubmitter({
      schema,
      errors: (e) => {
        throw e;
      },
      action: async () => {
        if (fail) throw new Error("boom");
        return "ok";
      },
    });
    await expect(s.submit({ name: "A" })).rejects.toThrow("boom");
    expect(s.pending).toBe(false);
    fail = false;
    expect(await s.submit({ name: "A" })).toEqual({ status: "success", result: "ok" });
  });

  test("confirm retries with the input the request asks for", async () => {
    const action = vi.fn(async (input: z.infer<typeof schema>) => {
      if (!input.force) throw new Error("confirm");
      return "saved";
    });
    const errors: ErrorAdapter = () => ({
      confirm: { message: "Sure?", retry: (input: z.infer<typeof schema>) => ({ ...input, force: true }) },
    });
    const s = createSubmitter({ schema, action, errors });
    expect((await s.submit({ name: "A" })).status).toBe("confirm");
    expect(await s.confirm()).toEqual({ status: "success", result: "saved" });
    expect(action).toHaveBeenLastCalledWith({ name: "A", force: true });
    // - a confirm is used once
    expect(await s.confirm()).toEqual({ status: "cancelled" });
  });

  test("latest wins: a running save finishes, the newest waiting one runs, older ones are superseded", async () => {
    const first = deferred<string>();
    const calls: string[] = [];
    const pending: boolean[] = [];
    const s = createSubmitter({
      schema,
      onPending: (p) => pending.push(p),
      action: async (input) => {
        calls.push(input.name);
        return input.name === "A" ? first.promise : input.name;
      },
    });
    const a = s.submit({ name: "A" });
    await vi.waitFor(() => expect(calls).toEqual(["A"]));
    const b = s.submit({ name: "B" });
    const c = s.submit({ name: "C" });
    expect(s.pending).toBe(true);
    first.resolve("A");
    expect(await a).toEqual({ status: "success", result: "A" });
    expect(await b).toEqual({ status: "superseded" });
    expect(await c).toEqual({ status: "success", result: "C" });
    expect(calls).toEqual(["A", "C"]);
    expect(pending).toEqual([true, false]);
    expect(s.pending).toBe(false);
  });
});

describe("autosave", () => {
  afterEach(() => vi.useRealTimers());

  test("debounces, dedupes and flushes", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const a = createAutosave<{ n: number }>({ delay: 100, save });
    a.saved({ n: 0 });

    a.change({ n: 1 });
    a.change({ n: 2 });
    vi.advanceTimersByTime(99);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledExactlyOnceWith({ n: 2 });

    // - same state again: skipped
    a.change({ n: 2 });
    vi.advanceTimersByTime(100);
    expect(save).toHaveBeenCalledTimes(1);

    // - flush saves a waiting change immediately
    a.change({ n: 3 });
    a.flush();
    expect(save).toHaveBeenLastCalledWith({ n: 3 });

    // - after a failure the same state may be saved again
    a.failed();
    a.change({ n: 3 });
    a.flush();
    expect(save).toHaveBeenCalledTimes(3);
  });

  test("initial state is not saved, cancel drops a waiting change", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const a = createAutosave<{ n: number }>({ delay: 100, save });
    a.saved({ n: 0 });
    a.change({ n: 0 });
    vi.runAllTimers();
    a.change({ n: 1 });
    a.cancel();
    vi.runAllTimers();
    expect(save).not.toHaveBeenCalled();
  });
});
