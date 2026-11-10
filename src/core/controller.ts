import { createAutosave, type Autosave } from "./autosave";
import { defaultBehavior, type Behavior } from "./behavior";
import { defaultErrorAdapter, routeErrors, type ConfirmRequest, type ErrorAdapter, type ServerError } from "./errors";
import type { FormDefinition } from "./form";
import type { Kinds } from "./kind";
import { resolve } from "./args";
import { getPath } from "./path";
import { validate, type FieldErrors } from "./schema";
import { emptyValueOf, schemaInfo, Session, type SchemaAdapter } from "./session";
import type { FieldDef } from "./field";
import { initialValues } from "./spec";
import { createStore, type FormStore } from "./store";
import { createSubmitter, type SubmitOutcome, type Submitter } from "./submit";
import { evaluate, type Slot, type View } from "./view";

/** What the controller exposes besides the store. A new object on every change. */
export interface ControllerState {
  readonly view: View;
  /** Authored index of the panel the user looks at. */
  readonly activePanel: number;
  /** The form was opened with a record. */
  readonly edit: boolean;
  /** A save is running. */
  readonly pending: boolean;
  /** Messages without a visible field: unplaced errors, then the server's message. */
  readonly summary: readonly string[];
  /** Authored indexes of panels with errors. */
  readonly errorPanels: ReadonlySet<number>;
  /** The server asks to confirm; answer with `confirm()` or `dismiss()`. */
  readonly confirm?: ConfirmRequest;
  /** Incremented after every successful save (for "saved" indicators). */
  readonly saves: number;
  /** Work registered with `busy()` is in flight: submit is blocked. */
  readonly busy: boolean;
  /** The session is a read-only view (`open({ readOnly })`). */
  readonly readOnly: boolean;
  /** Request to focus a field; `seq` changes with every request. */
  readonly focus?: { readonly path: string; readonly seq: number };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDefinition = FormDefinition<any, any, any, any, any, any>;

/** Action input of a definition. */
export type InputOf<D> = NonNullable<D extends { readonly "~types"?: infer X } ? X : never> extends { input: infer I } ? I : never;

export interface ControllerOptions<D extends AnyDefinition, R> {
  readonly definition: D;
  readonly kinds: Kinds;
  readonly behavior?: Partial<Behavior>;
  readonly schema?: SchemaAdapter;
  readonly errors?: ErrorAdapter;
  readonly action: (input: InputOf<D>) => Promise<R> | R;
  readonly onSuccess?: (result: R) => void;
}

export interface OpenInput {
  /** The record being edited; `undefined` creates. */
  readonly value?: unknown;
  readonly ctx?: unknown;
  readonly props?: unknown;
  /** Show the record only: every field read-only, nothing to submit. */
  readonly readOnly?: boolean;
}

export interface Controller<R = unknown> {
  readonly store: FormStore<unknown>;
  readonly behavior: Behavior;
  getState(): ControllerState;
  subscribe(listener: () => void): () => void;
  /** Start a session: initial values, fresh history, no errors. Call before anything else. */
  open(input?: OpenInput): void;
  /** New context or props (e.g. from hooks on every render); re-evaluates when they changed. */
  setContext(input: { readonly ctx?: unknown; readonly props?: unknown }): void;
  /** A user edit: runs effects, validation timing and autosave. Code that sets values uses `store.set`. */
  change(path: string, value: unknown): void;
  /** The user left a field. */
  blur(path: string): void;
  /** User list operations (same effects as `change`). */
  readonly rows: {
    append(path: string, row: unknown): void;
    insert(path: string, index: number, row: unknown): void;
    remove(path: string, index: number): void;
    move(path: string, from: number, to: number): void;
  };
  setPanel(index: number): void;
  /** Empty value of a field at a path (schema adapter → kind → list `[]`). */
  emptyValue(path: string, def: FieldDef): unknown;
  /** Required marker for a path (schema adapter; `false` without one). */
  required(path: string): boolean;
  /** Current arguments of dynamic properties (`values`, `ctx`, `props`, `edit`). */
  args(): { readonly values: unknown; readonly ctx: unknown; readonly props: unknown; readonly edit: boolean };
  submit(): Promise<SubmitOutcome<R>>;
  confirm(): Promise<SubmitOutcome<R>>;
  dismiss(): void;
  /** Back to the values the session opened with (same record, context and props). */
  reset(): void;
  /**
   * Mark work in flight (an upload, a lookup): submit is blocked and autosave waits until it settles.
   * - Returns the same promise, so it can wrap the call: `await api.busy(upload(file))`.
   */
  busy<T>(work: Promise<T>): Promise<T>;
  /** Save a waiting autosave now (page hidden, form closed). */
  flush(): void;
  dispose(): void;
}

type Args = { values: unknown; ctx: unknown; props: unknown; edit: boolean; row?: unknown; index?: number };

const inScope = (path: string, scope: string) => path === scope || path.startsWith(`${scope}.`);
const pick = (errors: FieldErrors, scope: string) => Object.fromEntries(Object.entries(errors).filter(([p]) => inScope(p, scope)));

/**
 * One form, framework-free: store + evaluation + rules + saving.
 * - Bindings render `getState().view` and the store, and forward user events.
 * - Every store change re-evaluates the view and applies the session's updates
 *   (fixed values, emptied hidden fields) until nothing changes.
 */
export function createController<D extends AnyDefinition, R = unknown>(options: ControllerOptions<D, R>): Controller<R> {
  type I = InputOf<D>;
  const spec = options.definition.spec;
  const autosaving = spec.autosave !== undefined && spec.autosave !== false;
  const behavior: Behavior = {
    ...defaultBehavior,
    ...options.behavior,
    // - with autosave every valid change is a submit: validate as the user types
    ...(autosaving && { validation: "change" as const }),
  };

  const store = createStore<unknown>({});
  // - the kit's adapter, bound to this form's schema
  const info = schemaInfo(options.schema, options.definition.schema);
  const session = new Session(behavior, options.kinds, info);
  const listeners = new Set<() => void>();
  let ctx: unknown;
  let props: unknown = {};
  let edit = false;
  let readOnly = false;
  let busyCount = 0;
  let lastOpen: OpenInput = {};
  let activePanel = 0;
  let serverMessage: string | undefined;
  let focusSeq = 0;
  // - per session: keeps derived configs stable by identity (see `evaluate`)
  let memo = new Map<string, unknown>();

  /** Server request + the form's own wording (`confirm.title` / `confirm.action` in the spec). */
  const confirmOf = (request: ConfirmRequest): ConfirmRequest => {
    const a = args(store.getState().values);
    const title = spec.confirm?.title !== undefined ? resolve(spec.confirm.title as never, a as never) : request.title;
    const action = spec.confirm?.action !== undefined ? resolve(spec.confirm.action as never, a as never) : request.action;
    return { ...request, ...(title !== undefined && { title }), ...(action !== undefined && { action }) };
  };
  let state: ControllerState;

  const args = (values: unknown): Args => ({ values, ctx, props, edit });

  // ── evaluation ───────────────────────────────────────────────────────────

  const compute = (): View => evaluate({ spec, values: store.getState().values, ctx, props, edit, readOnly, activePanel, memo, kinds: options.kinds });

  /** Evaluate and apply session updates until stable (bounded: updates converge quickly). */
  const settle = (): View => {
    let view = compute();
    for (let round = 0; round < 5; round++) {
      const values = store.getState().values;
      const updates = session.updates(view, values, store.keyedPath);
      if (updates.length === 0) break;
      store.batch(() => {
        for (const u of updates) store.set(u.path, u.value);
      });
      view = compute();
    }
    return view;
  };

  const publish = (patch: Partial<ControllerState> = {}, view = settle()) => {
    const routed = routeErrors(store.getState().errors, view);
    state = {
      ...state,
      ...patch,
      view,
      activePanel: view.activePanel,
      edit,
      readOnly,
      summary: [...routed.unplaced, ...(serverMessage ? [serverMessage] : [])],
      errorPanels: routed.panels,
    };
    for (const l of [...listeners]) l();
  };

  // - store changes from anywhere (user, effects, custom components) re-evaluate the view
  let publishing = false;
  const unsubscribe = store.subscribe(() => {
    if (publishing) return;
    publishing = true;
    try {
      publish();
    } finally {
      publishing = false;
    }
  });

  // ── validation timing ────────────────────────────────────────────────────

  const prepared = () => session.prepare(state.view, store.getState().values);

  /**
   * Re-validate after a user action at `path`.
   * - `"change"`, or after a submit on blur: show every error at and below `path`.
   * - After a submit on change: only drop errors that are fixed, never add new ones while typing.
   */
  const revalidate = async (path: string, reason: "change" | "blur") => {
    const { submitted, errors: before } = store.getState();
    const live = behavior.validation === "change";
    if (!live && !submitted) return;
    if (!live && reason === "change" && Object.keys(pick(before, path)).length === 0) return;

    const values = store.getState().values;
    const result = await validate(options.definition.schema, prepared());
    // - stale: the user typed on while validating
    if (store.getState().values !== values) return;
    const found = pick(result.errors ?? {}, path);
    const next = live || reason === "blur" ? found : Object.fromEntries(Object.entries(found).filter(([p]) => p in before));
    store.setErrors(next, path);
  };

  // ── saving ───────────────────────────────────────────────────────────────

  const submitter: Submitter<R> = createSubmitter<unknown, I, R>({
    schema: options.definition.schema,
    action: options.action,
    ...(options.errors && { errors: options.errors }),
    ...(spec.toInput && {
      toInput: (data: unknown) => (spec.toInput as unknown as (d: unknown, a: Args) => I | null | undefined)(data, args(store.getState().values)),
    }),
    ...(spec.confirm && {
      retry: (data: unknown) => (spec.confirm!.retry as unknown as (d: unknown, a: Args) => unknown)(data, args(store.getState().values)),
    }),
    onPending: (pending) => publish({ pending }, state.view),
  });

  const requestFocus = (errors: FieldErrors, view: View) => {
    const first = routeErrors(errors, view).placed[0];
    if (!first) return undefined;
    const slot = view.slots.find((s) => s.path === first.path || first.path.startsWith(`${s.path}.`));
    if (slot && slot.panel !== activePanel) activePanel = slot.panel;
    return behavior.focusFirstError ? { path: first.path, seq: ++focusSeq } : undefined;
  };

  const applyServerError = (error: ServerError) => {
    serverMessage = error.message;
    store.setErrors({ ...store.getState().errors, ...error.fields });
  };

  /** Handle an outcome; `interactive` = a submit by the user (focus, panel switch). */
  const settleOutcome = (outcome: SubmitOutcome<R>, values: unknown, interactive: boolean): SubmitOutcome<R> => {
    switch (outcome.status) {
      case "invalid": {
        store.setErrors(outcome.errors);
        autosave?.failed();
        const focus = interactive ? requestFocus(outcome.errors, state.view) : undefined;
        publish(focus ? { focus } : {});
        break;
      }
      case "failed": {
        applyServerError(outcome.error);
        autosave?.failed();
        const focus = interactive && outcome.error.fields ? requestFocus(outcome.error.fields, state.view) : undefined;
        publish(focus ? { focus } : {});
        break;
      }
      case "confirm":
        publish({ confirm: confirmOf(outcome.confirm) });
        break;
      case "success": {
        serverMessage = undefined;
        autosave?.saved(values);
        if (spec.afterSubmit === "reset") reopen();
        else if (interactive) store.setErrors({});
        publish({ saves: state.saves + 1 });
        options.onSuccess?.(outcome.result);
        break;
      }
      default:
        break;
    }
    return outcome;
  };

  const save = async (interactive: boolean): Promise<SubmitOutcome<R>> => {
    const values = store.getState().values;
    serverMessage = undefined;
    if (interactive) store.markSubmitted();
    const { confirm: _dropped, ...rest } = state;
    state = rest;
    return settleOutcome(await submitter.submit(prepared()), values, interactive);
  };

  const autosave: Autosave<unknown> | undefined = autosaving
    ? createAutosave({
        delay: typeof spec.autosave === "number" ? spec.autosave : behavior.autosaveDelay,
        save: () => void save(false),
      })
    : undefined;

  // ── user events ──────────────────────────────────────────────────────────

  const slotAt = (path: string): Slot | undefined => state.view.slots.find((s) => s.path === path);

  const runEffect = (path: string, value: unknown) => {
    const slot = slotAt(path);
    const effect = slot?.def.onChange as ((v: unknown, tools: unknown) => void | Promise<void>) | undefined;
    if (!slot || !effect) return;
    const values = store.getState().values;
    const tools = {
      set: (relative: string, next: unknown) => store.set(slot.scope ? `${slot.scope}.${relative}` : relative, next),
      args: {
        ...args(values),
        ...(slot.scope && { row: getPath(values, slot.scope), index: slot.index, parent: slot.parentScope === undefined ? undefined : getPath(values, slot.parentScope) }),
      },
    };
    guarded(() => effect(value, tools));
  };

  /** Run an effect: sync ones apply in the same tick, failures show like a save error. */
  const guarded = (run: () => void | Promise<void>) => {
    const fail = (error: unknown) => {
      serverMessage = (options.errors ?? defaultErrorAdapter)(error)?.message;
      publish();
    };
    try {
      const result = run();
      if (result instanceof Promise) result.catch(fail);
    } catch (error) {
      fail(error);
    }
  };

  /** Form-level `effects` whose `on` covers `path` (equal, below or above it). */
  const runSpecEffects = (path: string) => {
    for (const effect of spec.effects ?? []) {
      const on = effect.on as readonly string[];
      if (!on.some((p) => p === path || path.startsWith(`${p}.`) || p.startsWith(`${path}.`))) continue;
      const tools = { ...args(store.getState().values), set: (p: string, v: unknown) => store.set(p, v) };
      guarded(() => (effect.run as (t: unknown) => void | Promise<void>)(tools));
    }
  };

  const afterUserChange = (path: string) => {
    runSpecEffects(path);
    void revalidate(path, "change");
    autosave?.change(store.getState().values);
  };

  let reopen = () => {};

  const controller: Controller<R> = {
    store,
    behavior,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      controller.open(lastOpen);
    },
    busy(work) {
      busyCount++;
      publish({ busy: true }, state.view);
      const done = () => {
        busyCount--;
        if (busyCount > 0) return;
        publish({ busy: false }, state.view);
        // - a change made while busy was not autosaved: try now
        if (autosave && store.isDirty()) autosave.change(store.getState().values);
      };
      return work.then(
        (result) => (done(), result),
        (error: unknown) => {
          done();
          throw error;
        },
      );
    },
    open(input = {}) {
      ctx = input.ctx;
      props = input.props ?? {};
      edit = input.value !== undefined;
      readOnly = input.readOnly === true;
      lastOpen = input;
      activePanel = 0;
      serverMessage = undefined;
      reopen = () => {
        session.reset();
        memo = new Map();
        store.reset(initialValues(spec, { value: input.value, ctx, props }));
      };
      submitter.dismiss();
      autosave?.cancel();
      const { focus: _focus, confirm: _confirm, ...rest } = state;
      state = { ...rest, saves: 0 };
      reopen();
      // - fixed values are applied by the store subscription; the settled state is the baseline
      autosave?.saved(store.getState().values);
      if (store.isDirty()) store.reset(store.getState().values);
    },
    setContext(input) {
      if (Object.is(input.ctx, ctx) && Object.is(input.props, props)) return;
      ctx = input.ctx;
      props = input.props ?? {};
      publish();
    },
    change(path, value) {
      if (readOnly) return;
      store.set(path, value);
      runEffect(path, value);
      afterUserChange(path);
    },
    blur(path) {
      store.touch(path);
      void revalidate(path, "blur");
    },
    rows: {
      append: (path, row) => (store.rows.append(path, row), afterUserChange(path)),
      insert: (path, index, row) => (store.rows.insert(path, index, row), afterUserChange(path)),
      remove: (path, index) => (store.rows.remove(path, index), afterUserChange(path)),
      move: (path, from, to) => (store.rows.move(path, from, to), afterUserChange(path)),
    },
    args: () => args(store.getState().values),
    emptyValue: (path, def) => emptyValueOf(path, def, options.kinds, info),
    required: (path) => info?.required?.(path) ?? false,
    setPanel(index) {
      if (index === activePanel) return;
      activePanel = index;
      publish();
    },
    submit: () => {
      // - nothing to save in a read-only view; nothing to save while work is in flight
      if (readOnly || busyCount > 0) return Promise.resolve({ status: "cancelled" as const });
      autosave?.cancel();
      return save(true);
    },
    async confirm() {
      const values = store.getState().values;
      const { confirm: _dropped, ...rest } = state;
      state = rest;
      publish();
      return settleOutcome(await submitter.confirm(), values, true);
    },
    dismiss() {
      submitter.dismiss();
      const { confirm: _dropped, ...rest } = state;
      state = rest;
      publish();
    },
    flush: () => autosave?.flush(),
    dispose() {
      autosave?.flush();
      unsubscribe();
      listeners.clear();
    },
  };

  state = {
    // - nothing is evaluated before `open`: user functions never see missing props
    view: { navigation: spec.navigation, panels: [], activePanel: -1, slots: [] },
    activePanel: 0,
    edit: false,
    pending: false,
    summary: [],
    errorPanels: new Set(),
    saves: 0,
    busy: false,
    readOnly: false,
  };
  return controller;
}
