// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { controlProps, createFormKit, kind, type FieldProps } from "../../src/react";
import { resetKindChecks } from "../../src/react/control";
import { layout } from "./html-kit";

afterEach(cleanup);
beforeEach(() => resetKindChecks());

const base: FieldProps<string> = { id: "x", value: "", onChange: () => {}, onBlur: () => {}, readOnly: false, invalid: false, config: undefined };

describe("controlProps", () => {
  test("only what is set", () => {
    expect(controlProps(base)).toEqual({ id: "x", onBlur: base.onBlur, readOnly: false });
    expect(controlProps({ ...base, invalid: true, placeholder: "p", readOnly: true })).toEqual({
      id: "x",
      onBlur: base.onBlur,
      readOnly: true,
      placeholder: "p",
      "aria-invalid": true,
    });
  });
});

describe("kind check", () => {
  const s = z.object({ a: z.string(), b: z.string() });

  test("warns once per kind that drops props.id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    function NoId({ value, onChange }: FieldProps<string>) {
      return <input value={value} onChange={(e) => onChange(e.target.value)} />;
    }
    function WithId(props: FieldProps<string>) {
      return <input {...controlProps(props)} value={props.value} onChange={(e) => props.onChange(e.target.value)} />;
    }
    const { form } = createFormKit({ kinds: { broken: kind(NoId, { empty: "" }), fine: kind(WithId, { empty: "" }) }, layout });
    const Form = form(s, (f) => ({ sections: [{ fields: { a: f.broken("A"), b: f.broken("B") } }] }));
    const Good = form(s, (f) => ({ sections: [{ fields: { a: f.fine("A") } }] }));
    render(<Form inline action={vi.fn()} />);
    render(<Good inline action={vi.fn()} />);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('kind "broken" renders no element with props.id');
    warn.mockRestore();
  });
});
