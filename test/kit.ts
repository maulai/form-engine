import { createForm, kind } from "../src/core";

/** Minimal kit for tests: kinds only, no renderers. */
export type Options = ReadonlyMap<string, string> | readonly string[];

export const kinds = {
  text: kind<string>({ empty: "" }),
  textarea: kind<string>({ empty: "" }),
  number: kind<number | null>({ empty: null }),
  switch: kind<boolean>({ empty: false }),
  date: kind<string>({ empty: "" }),
  select: kind<string>({ empty: "" }).params((options: Options) => ({ options })),
  tags: kind<string[]>({ empty: [] }).params((options: Options) => ({ options })),
};

export const form = createForm(kinds);
