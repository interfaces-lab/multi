import { vi } from "vitest";

const stylex = vi.hoisted(() => {
  const classNames = new Map<unknown, string>();

  const className = (style: unknown): string => {
    const existing = classNames.get(style);
    if (existing !== undefined) return existing;

    const next = `stylex-${String(classNames.size)}`;
    classNames.set(style, next);
    return next;
  };

  return {
    create: <Styles>(styles: Styles): Styles => styles,
    createTheme: <Values>(_variables: unknown, values: Values): Values => values,
    defineVars: (values: Readonly<Record<string, unknown>>) =>
      Object.fromEntries(Object.keys(values).map((name) => [name, `var(${name})`])),
    props: (...styles: unknown[]) => ({
      className: styles.filter(Boolean).map(className).join(" "),
    }),
  };
});

vi.mock("@stylexjs/stylex", () => stylex);
