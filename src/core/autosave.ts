export interface AutosaveOptions<T> {
  /** Debounce in ms. */
  readonly delay: number;
  readonly save: (values: T) => void;
  /** Identity of a state; equal states are not saved twice. Default: `JSON.stringify`. */
  readonly key?: (values: T) => string;
}

export interface Autosave<T> {
  /** A change happened: save `values` after the delay unless another change comes first. */
  change(values: T): void;
  /** Save a waiting change now (tab hidden, page left, form closed). */
  flush(): void;
  /** Drop a waiting change. */
  cancel(): void;
  /** Record a state as saved (initial values, or after a successful save). */
  saved(values: T): void;
  /** The last save failed: the same state may be saved again. */
  failed(): void;
}

/**
 * Debounced saving.
 * - Framework-free: the binding calls `flush` on page hide and unmount.
 * - Ordering of overlapping saves is the submitter's job (latest wins).
 */
export function createAutosave<T>(options: AutosaveOptions<T>): Autosave<T> {
  const key = options.key ?? ((v: T) => JSON.stringify(v));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: { values: T } | undefined;
  // - last state handed to `save` (or confirmed saved); equal states are skipped
  let lastSent: string | undefined;

  const run = () => {
    timer = undefined;
    const next = latest;
    latest = undefined;
    if (!next) return;
    const k = key(next.values);
    if (k === lastSent) return;
    lastSent = k;
    options.save(next.values);
  };

  return {
    change(values) {
      latest = { values };
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(run, options.delay);
    },
    flush() {
      if (timer !== undefined) clearTimeout(timer);
      run();
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      latest = undefined;
    },
    saved(values) {
      lastSent = key(values);
    },
    failed() {
      lastSent = undefined;
    },
  };
}
