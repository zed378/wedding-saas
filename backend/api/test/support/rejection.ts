/**
 * Run something that must reject, and hand back the error it rejected with.
 *
 * `promise.catch((e) => e as SomeError)` looks equivalent and is not: its type is
 * `Result | SomeError`, so every property access afterwards is a type error, and adding a
 * cast to silence that would also silence the case where the call unexpectedly *resolves*
 * -- which is the one outcome the test must never pass on.
 *
 * This narrows, and fails loudly if nothing was thrown.
 */
export async function rejection<E = ThrownAppError>(
  fn: () => Promise<unknown>,
): Promise<E> {
  try {
    await fn();
  } catch (error) {
    return error as E;
  }
  throw new Error("expected the call to reject, and it resolved");
}

/** The shape `AppExceptionFilter` maps. Most rejections in these suites are one of these. */
export interface ThrownAppError extends Error {
  readonly status: number;
  readonly code: string;
}
