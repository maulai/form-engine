import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  createController,
  resolve,
  type AnyDefinition,
  type Args,
  type Controller,
  type Element,
  type PathValue,
  type RowArgs,
  type RowsPath,
  type Size,
  type SpecData,
} from "../core";
import { FormContext, useOptionalFieldContext, type FormContextValue } from "./context";
import { useArgs, useSelector, useValues, type FieldArgs } from "./hooks";
import { PanelNavHost, PickerHost, Sections, sidebarPickerField } from "./renderer";
import type { Kit } from "./types";

// ── types ──────────────────────────────────────────────────────────────────

type TypesOf<Def> = NonNullable<Def extends { readonly "~types"?: infer X } ? X : never>;
type ValueOf<Def> = TypesOf<Def> extends { value: infer V } ? V : never;
type InputOf<Def> = TypesOf<Def> extends { input: infer I } ? I : never;
type PropsOf<Def> = TypesOf<Def> extends { props: infer P } ? P : never;
type ValuesOf<Def> = TypesOf<Def> extends { values: infer T } ? T : never;
type CtxOf<Def> = TypesOf<Def> extends { ctx: infer C } ? C : never;

/** Props every generated form takes. */
export interface BaseFormProps<V, I, R> {
  /** The record to edit; without it the form creates. */
  readonly value?: V;
  /** Saves the input; throw to reject (the kit's error adapter turns errors into messages). */
  readonly action: (input: I) => Promise<R> | R;
  /** After a successful save, with the action's result (navigate, show a secret, …). */
  readonly onSuccess?: (result: R) => void;
  /** Dialog opener; the dialog manages its open state itself. */
  readonly trigger?: ReactNode;
  /** Controlled dialog. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** Render on the page instead of in a dialog. */
  readonly inline?: boolean;
  /** Presentation overrides for this call site. */
  readonly title?: string;
  readonly description?: string;
  readonly submitLabel?: string;
  /** Data for the form is still loading: placeholders, no submit; the session starts when it is done. */
  readonly pending?: boolean;
  /** Show the record only: every field read-only, no submit. Switching it starts a fresh session. */
  readonly readOnly?: boolean;
}

export type FormProps<Def, R> = BaseFormProps<ValueOf<Def>, InputOf<Def>, R> & PropsOf<Def>;

/** What `form(...)` returns in React: a component, plus its definition for tests and tooling. */
export interface FormComponent<Def> {
  <R = unknown>(props: FormProps<Def, R>): ReactElement;
  readonly definition: Def;
  /** `useValues`, typed by this form. */
  readonly useValues: <R>(select: (values: ValuesOf<Def>) => R) => R;
  /** `useArgs` at form level, typed by this form. */
  readonly useArgs: <R>(select: (args: Args<ValuesOf<Def>, CtxOf<Def>, PropsOf<Def>>) => R) => R;
  /**
   * `useArgs` inside a row of the list at `path`, typed by it.
   * - Throws when used outside such a row.
   */
  readonly useRowArgs: <Q extends RowsPath<ValuesOf<Def>>, R>(
    path: Q,
    select: (args: RowArgs<ValuesOf<Def>, CtxOf<Def>, PropsOf<Def>, Element<PathValue<ValuesOf<Def>, Q>>>) => R,
  ) => R;
}

const BASE_KEYS = ["value", "action", "onSuccess", "trigger", "open", "onOpenChange", "inline", "title", "description", "submitLabel", "pending", "readOnly"];

// ── helpers ────────────────────────────────────────────────────────────────

/** Keep the previous object while its top-level entries are the same (hook results, rest props). */
function useShallowStable<T>(value: T): T {
  const ref = useRef(value);
  const prev = ref.current;
  const same =
    Object.is(prev, value) ||
    (typeof prev === "object" &&
      typeof value === "object" &&
      prev !== null &&
      value !== null &&
      Object.keys(prev).length === Object.keys(value).length &&
      Object.entries(value).every(([k, v]) => Object.is((prev as Record<string, unknown>)[k], v)));
  if (!same) ref.current = value;
  return ref.current;
}

/** Size from the content unless the spec sets one: a left column (panels, sidebar picker) is `xl`. */
function sizeOf(spec: SpecData, sidebar: boolean): Size {
  if (spec.size) return spec.size;
  if (spec.navigation || sidebar) return "xl";
  const hasRows = spec.panels.some((p) => p.sections.some((s) => s.fields.some((f) => f.def.kind === "rows")));
  return hasRows ? "lg" : "md";
}

const SAVED_MS = 2000;

// ── component ──────────────────────────────────────────────────────────────

export function createFormComponent<Def extends AnyDefinition>(definition: Def, kit: Kit): FormComponent<Def> {
  const { spec } = definition;
  const autosave = spec.autosave !== undefined && spec.autosave !== false;

  function Form(all: Record<string, unknown>) {
    const base = all as unknown as BaseFormProps<unknown, unknown, unknown>;
    const readOnly = base.readOnly === true;
    const props = useShallowStable(Object.fromEntries(Object.entries(all).filter(([k]) => !BASE_KEYS.includes(k))));
    // - the definition's context hook, called on every render like any hook
    const ctx = useShallowStable(definition.context ? definition.context({ props }) : undefined);
    // - data still loading: the `pending` prop, or a context hook that returns nothing yet
    const loading = base.pending === true || (definition.context !== undefined && ctx === undefined);

    const handlers = useRef(base);
    handlers.current = base;
    const close = useRef<() => void>(() => {});
    // - a session runs from open (with data) until the dialog closes
    const opened = useRef(false);

    const [controller] = useState<Controller>(() => {
      const c = createController({
        definition,
        kinds: kit.kinds,
        ...(kit.behavior && { behavior: kit.behavior }),
        ...(kit.schema && { schema: kit.schema }),
        ...(kit.errors && { errors: kit.errors }),
        action: (input: unknown) => handlers.current.action(input),
        onSuccess: (result: unknown) => {
          handlers.current.onSuccess?.(result);
          close.current();
        },
      });
      // - inline forms with their data are open from the first render (no empty frame)
      if (base.inline && !loading) {
        c.open({ value: base.value, ctx, props, readOnly });
        opened.current = true;
      }
      return c;
    });

    const uid = useId();
    const context = useMemo<FormContextValue>(
      () => ({ controller, kit, idOf: (path) => `${uid}-${path}` }),
      [controller, uid],
    );
    const state = useSelector(controller.subscribe, controller.getState, (s) => s);

    // ── open / close ───────────────────────────────────────────────────────
    const [internalOpen, setInternalOpen] = useState(false);
    const controlled = base.open !== undefined;
    const open = base.inline ? true : controlled ? base.open! : internalOpen;
    const setOpen = (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      handlers.current.onOpenChange?.(next);
    };
    const [discarding, setDiscarding] = useState(false);

    close.current = () => {
      const after = spec.afterSubmit ?? "close";
      if (!base.inline && !autosave && after === "close") setOpen(false);
    };

    const requestClose = () => {
      // - a confirm is on top: close requests come from it (focus, outside clicks), not from the user
      if (discarding || controller.getState().confirm) return;
      const dirty = controller.store.isDirty();
      if (controller.behavior.confirmDiscard && dirty && !controller.getState().pending) setDiscarding(true);
      else setOpen(false);
    };

    // - a dialog starts a fresh session on every open, as soon as its data is there
    useLayoutEffect(() => {
      if (!open) {
        opened.current = false;
        return;
      }
      if (opened.current || loading) return;
      controller.open({ value: base.value, ctx, props, readOnly });
      opened.current = true;
    });

    // - inline: a new record from outside reloads the form, unless the user is editing
    const lastValue = useRef(base.value);
    useLayoutEffect(() => {
      if (!base.inline || !opened.current || Object.is(lastValue.current, base.value)) return;
      lastValue.current = base.value;
      if (!controller.store.isDirty()) controller.open({ value: base.value, ctx, props, readOnly });
    });

    // - switching between view and edit starts a fresh session
    const lastReadOnly = useRef(readOnly);
    useLayoutEffect(() => {
      if (!opened.current || lastReadOnly.current === readOnly) return;
      lastReadOnly.current = readOnly;
      controller.open({ value: base.value, ctx, props, readOnly });
    });

    useLayoutEffect(() => {
      if (opened.current && !loading) controller.setContext({ ctx, props });
    }, [controller, ctx, props, loading]);

    // ── browser duties ─────────────────────────────────────────────────────
    // - leaving the page with unsaved changes asks first (autosave forms flush instead)
    useEffect(() => {
      if (!open || readOnly || autosave || !controller.behavior.confirmDiscard) return;
      const onBeforeUnload = (event: BeforeUnloadEvent) => {
        if (!controller.store.isDirty()) return;
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [controller, open, readOnly]);

    useEffect(() => {
      if (!state.focus) return;
      const el = document.getElementById(context.idOf(state.focus.path));
      el?.focus({ preventScroll: true });
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }, [state.focus, context]);

    useEffect(() => {
      if (!autosave) return;
      const flush = () => controller.flush();
      const onVisibility = () => document.visibilityState === "hidden" && flush();
      window.addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        window.removeEventListener("pagehide", flush);
        document.removeEventListener("visibilitychange", onVisibility);
        // - unmount (dialog closed, route left): nothing younger than the debounce is lost
        flush();
      };
    }, [controller]);

    const [saved, setSaved] = useState(false);
    useEffect(() => {
      if (state.saves === 0) return;
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), SAVED_MS);
      return () => clearTimeout(timer);
    }, [state.saves]);

    // ── render ─────────────────────────────────────────────────────────────
    const { layout, messages } = kit;
    const formId = `${uid}-form`;
    const activePanel = state.view.panels.find((p) => p.active);
    const args = controller.args();
    const submitLabel =
      base.submitLabel ?? (spec.submit?.label !== undefined ? resolve(spec.submit.label as never, args as never) : undefined) ?? messages.submit;
    const title = base.title ?? state.view.title;
    const description = base.description ?? state.view.description;

    const onSubmit = (event: FormEvent) => {
      event.preventDefault();
      void controller.submit();
    };
    // - Ctrl/Cmd+Enter submits from anywhere in the form, also from textareas
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !autosave && !readOnly) {
        event.preventDefault();
        void controller.submit();
      }
    };

    // - placeholders until the first session with data; a later refetch keeps the form
    const showLoading = loading && !opened.current;
    const body = showLoading ? (
      <layout.Loading />
    ) : (
      <form id={formId} noValidate onSubmit={onSubmit} onKeyDown={onKeyDown}>
        {activePanel && <Sections sections={activePanel.sections} />}
      </form>
    );
    const sidebarPicker = !showLoading && !spec.navigation && activePanel ? sidebarPickerField(activePanel.sections) : undefined;
    const aside = sidebarPicker ? <PickerHost field={sidebarPicker} /> : undefined;
    const footer = (
      <>
        {state.summary.length > 0 && <layout.Summary messages={state.summary} />}
        {readOnly ? null : autosave ? (
          <layout.AutosaveStatus pending={state.pending} saved={saved} />
        ) : (
          <layout.SubmitButton
            form={formId}
            label={submitLabel}
            pending={state.pending}
            saved={saved}
            disabled={loading || state.busy}
            destructive={spec.submit?.destructive ?? false}
            {...(spec.submit?.icon !== undefined && { icon: spec.submit.icon })}
          />
        )}
      </>
    );
    const nav = spec.navigation && !showLoading ? <PanelNavHost /> : undefined;
    // - inside the shell's content, not beside it: dialog libraries (e.g. Radix) recognise nested
    //   dialogs by the React tree; as siblings, focus moving into the confirm reads as
    //   "interaction outside" and the form dialog asks to close again
    const confirms = (
      <>
        <layout.ConfirmDialog
          open={state.confirm !== undefined}
          title={state.confirm?.title ?? messages.confirmTitle}
          message={state.confirm?.message ?? ""}
          confirm={state.confirm?.action ?? messages.confirmAction}
          cancel={messages.cancel}
          destructive={false}
          onConfirm={() => void controller.confirm()}
          onCancel={controller.dismiss}
        />
        <layout.ConfirmDialog
          open={discarding}
          title={messages.discardTitle}
          message={messages.discardMessage}
          confirm={messages.discardConfirm}
          cancel={messages.keepEditing}
          destructive
          onConfirm={() => {
            setDiscarding(false);
            setOpen(false);
          }}
          onCancel={() => setDiscarding(false)}
        />
      </>
    );
    const shared = {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(nav && { nav }),
      ...(aside && { aside }),
      footer,
      children: (
        <>
          {body}
          {confirms}
        </>
      ),
    };

    return (
      <FormContext.Provider value={context}>
        {base.inline ? (
          <layout.Inline {...shared} />
        ) : (
          <layout.Dialog
            {...shared}
            open={open}
            onOpenChange={(next) => (next ? setOpen(true) : requestClose())}
            size={sizeOf(spec, aside !== undefined)}
            {...(base.trigger !== undefined && { trigger: base.trigger })}
          />
        )}
      </FormContext.Provider>
    );
  }

  // - the generic hooks, typed by this form (they still read the form from context)
  const useFormValues = (select: (values: unknown) => unknown) => useValues(select);
  const useFormArgs = (select: (args: FieldArgs) => unknown) => useArgs(select);
  const useFormRowArgs = (path: string, select: (args: FieldArgs) => unknown) => {
    const field = useOptionalFieldContext();
    if (!field?.scope.startsWith(`${path}.`)) throw new Error(`form-engine: useRowArgs("${path}") used outside a row of "${path}"`);
    return useArgs(select);
  };
  return Object.assign(Form as unknown as FormComponent<Def>, {
    definition,
    useValues: useFormValues,
    useArgs: useFormArgs,
    useRowArgs: useFormRowArgs,
  }) as FormComponent<Def>;
}
