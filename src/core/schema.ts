/**
 * Standard Schema v1 (https://standardschema.dev).
 * - Copied interface, no dependency; implemented by zod, valibot, arktype and others.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }
  type Result<Output> = SuccessResult<Output> | FailureResult;
  interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  interface PathSegment {
    readonly key: PropertyKey;
  }
  interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
  type InferInput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["input"];
  type InferOutput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["output"];
}

/** Field errors keyed by dot path, as the engine stores them. */
export type FieldErrors = Record<string, string>;

/**
 * Run a schema and flatten its issues.
 * - Issue paths become dot paths (`items.2.name`).
 * - Issues without a path go to `""` (form-level message).
 */
export async function validate<Out>(
  schema: StandardSchemaV1<unknown, Out>,
  value: unknown,
): Promise<{ value: Out; errors?: undefined } | { value?: undefined; errors: FieldErrors }> {
  const result = await schema["~standard"].validate(value);
  if (!result.issues) return { value: result.value };
  const errors: FieldErrors = {};
  for (const issue of result.issues) {
    const path = (issue.path ?? []).map((s) => String(typeof s === "object" ? s.key : s)).join(".");
    // - first message per path wins, it is usually the most specific
    errors[path] ??= issue.message;
  }
  return { errors };
}
