/**
 * Class name joining. Deliberately tiny.
 *
 * `clsx` and `classnames` do this in a few hundred bytes with more features; this
 * package needs exactly the array-and-falsy behaviour and nothing else, and a
 * dependency that every component imports is a dependency in every app's bundle.
 */
export type ClassValue = string | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
