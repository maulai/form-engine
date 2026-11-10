// ── authoring ──────────────────────────────────────────────────────────────
export { createForm } from "./form";
export type { ContextHook, DefinitionWrap, FormChain, FormDefinition, FormFn, Wrap, Wrapped } from "./form";
export { kind, singleOption, CONTENT_KINDS, RESERVED_KINDS } from "./kind";
export type { Kind, KindBuilder, KindOptions, Kinds, ReservedKind } from "./kind";
export { FieldBuilder } from "./field";
export type { AnyField, Bindable, ChangeTools, Condition, Field, FieldDef } from "./field";
export { createFactory, entries } from "./factory";
export type { AddOption, Entry, Factory, FieldMap, ListArgs, ListArgsIn, Picker, PickerOptions, Rows, RowsOptions } from "./factory";
export { initialValues, normalize } from "./spec";
export type {
  DeepPartial,
  DefaultsFn,
  FormSpec,
  Panel,
  PanelData,
  PanelStatus,
  Section,
  SectionData,
  Size,
  SpecData,
  SpecLayout,
  SubmitSpec,
  ToInputFn,
  ConfirmSpec,
  EffectSpec,
  When,
} from "./spec";
export { resolve } from "./args";
export type { Args, Content, Dyn, DynContent, Hint, RowArgs, RowOf, Tone } from "./args";

// ── runtime ────────────────────────────────────────────────────────────────
export { defaultBehavior } from "./behavior";
export type { Behavior } from "./behavior";
export { evaluate, passes } from "./view";
export type { EvaluateInput, FieldScope, FieldView, ResolvedRowsOptions, PanelView, RowView, SectionView, Slot, View } from "./view";
export { emptyValueOf, schemaInfo, Session } from "./session";
export type { SchemaAdapter, SchemaInfo, ValueUpdate } from "./session";
export { defaultErrorAdapter, routeErrors } from "./errors";
export type { ConfirmRequest, ErrorAdapter, RoutedErrors, ServerError } from "./errors";
export { createSubmitter } from "./submit";
export type { SubmitOutcome, Submitter, SubmitterOptions } from "./submit";
export { createAutosave } from "./autosave";
export { createStore } from "./store";
export { configFor, freeValues, narrowUnique } from "./unique";
export type { FormStore, RowOps, StoreState } from "./store";
export type { Autosave, AutosaveOptions } from "./autosave";
export { createController } from "./controller";
export type { AnyDefinition, Controller, ControllerOptions, ControllerState, InputOf, OpenInput } from "./controller";

// ── utilities ──────────────────────────────────────────────────────────────
export { getPath, isPresent, setPath, unsetPath } from "./path";
export { equal } from "./equal";
export type { Element, Leaf, Path, PathValue, RowsPath } from "./path";
export { validate } from "./schema";
export type { FieldErrors, StandardSchemaV1 } from "./schema";
