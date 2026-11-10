import { defaultErrorAdapter, type ConfirmRequest, type ErrorAdapter, type ServerError } from "./errors";
import { validate, type FieldErrors, type StandardSchemaV1 } from "./schema";

/** How one submit ended. */
export type SubmitOutcome<R> =
  | { readonly status: "success"; readonly result: R }
  /** Schema rejected the values; nothing was sent. */
  | { readonly status: "invalid"; readonly errors: FieldErrors }
  /** The action threw; `error` comes from the error adapter. */
  | { readonly status: "failed"; readonly error: ServerError }
  /** The server asks to confirm; call `confirm()` to retry, or drop it. */
  | { readonly status: "confirm"; readonly confirm: ConfirmRequest }
  /** `toInput` returned nothing, or the adapter handled the error itself. */
  | { readonly status: "cancelled" }
  /** A newer submit replaced this one before it ran. */
  | { readonly status: "superseded" };

export interface SubmitterOptions<O, I, R> {
  readonly schema: StandardSchemaV1<unknown, O>;
  /** Validated output → action input; `null`/`undefined` cancels. Default: output as is. */
  readonly toInput?: (data: O) => I | null | undefined;
  readonly action: (input: I) => Promise<R> | R;
  readonly errors?: ErrorAdapter;
  /** The form's answer to a confirm request: validated values for the retry (then `toInput` again). */
  readonly retry?: (data: O) => O;
  /** Called whenever `pending` changes. */
  readonly onPending?: (pending: boolean) => void;
}

export interface Submitter<R> {
  /** Validate and save. While a save runs, the latest call waits and earlier waiting calls are superseded. */
  submit(values: unknown): Promise<SubmitOutcome<R>>;
  /** Answer the last `confirm` outcome: retry with the form's `retry` (or the request's). */
  confirm(): Promise<SubmitOutcome<R>>;
  /** Forget a pending confirm request. */
  dismiss(): void;
  readonly pending: boolean;
}

type Job<R> = {
  readonly run: () => Promise<SubmitOutcome<R>>;
  readonly done: (outcome: SubmitOutcome<R>) => void;
  readonly fail: (error: unknown) => void;
};

/**
 * The submit pipeline: validate → toInput → action → classify errors.
 * - Latest wins: one save at a time; a submit during a save waits, a newer one replaces it.
 *   Fast typing with autosave never saves an older state last.
 */
export function createSubmitter<O, I = O, R = unknown>(options: SubmitterOptions<O, I, R>): Submitter<R> {
  const classify = options.errors ?? defaultErrorAdapter;
  let running = false;
  let waiting: Job<R> | undefined;
  let lastConfirm: { request: ConfirmRequest; data: O; input: I } | undefined;

  const setRunning = (next: boolean) => {
    if (running === next) return;
    running = next;
    options.onPending?.(next);
  };

  const toInput = (data: O): I | null | undefined => (options.toInput ? options.toInput(data) : (data as unknown as I));

  const send = async (data: O, input: I): Promise<SubmitOutcome<R>> => {
    try {
      return { status: "success", result: await options.action(input) };
    } catch (error) {
      const server = classify(error);
      if (server === null) return { status: "cancelled" };
      if (server.confirm) {
        // - nobody knows how to retry: the request is just a message
        if (!options.retry && !server.confirm.retry) return { status: "failed", error: { message: server.confirm.message } };
        lastConfirm = { request: server.confirm, data, input };
        return { status: "confirm", confirm: server.confirm };
      }
      return { status: "failed", error: server };
    }
  };

  const attempt = async (values: unknown): Promise<SubmitOutcome<R>> => {
    const checked = await validate(options.schema, values);
    if (checked.errors) return { status: "invalid", errors: checked.errors };
    const input = toInput(checked.value);
    if (input == null) return { status: "cancelled" };
    return send(checked.value, input);
  };

  /** Second attempt: the form's `retry` on the values (preferred), else the adapter's on the input. */
  const retry = (pending: { request: ConfirmRequest; data: O; input: I }): Promise<SubmitOutcome<R>> => {
    if (options.retry) {
      const data = options.retry(pending.data);
      const input = toInput(data);
      return input == null ? Promise.resolve({ status: "cancelled" }) : send(data, input);
    }
    return send(pending.data, pending.request.retry!(pending.input as never) as I);
  };

  const enqueue = (run: () => Promise<SubmitOutcome<R>>): Promise<SubmitOutcome<R>> =>
    new Promise((done, fail) => {
      const job: Job<R> = { run, done, fail };
      if (!running) return void start(job);
      waiting?.done({ status: "superseded" });
      waiting = job;
    });

  const start = async (job: Job<R>) => {
    setRunning(true);
    try {
      job.done(await job.run());
    } catch (error) {
      // - an adapter (or schema) that throws lets the error escape this submit, not hang it
      job.fail(error);
    } finally {
      const next = waiting;
      waiting = undefined;
      if (next) void start(next);
      else setRunning(false);
    }
  };

  return {
    submit: (values) => {
      lastConfirm = undefined;
      return enqueue(() => attempt(values));
    },
    confirm: () => {
      const pending = lastConfirm;
      lastConfirm = undefined;
      if (!pending) return Promise.resolve({ status: "cancelled" });
      return enqueue(() => retry(pending));
    },
    dismiss: () => {
      lastConfirm = undefined;
    },
    get pending() {
      return running;
    },
  };
}
