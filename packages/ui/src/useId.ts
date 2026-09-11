import { useId as reactUseId } from "react";

/**
 * A stable id for label/control association.
 *
 * React 19's `useId` is SSR-safe, which matters here: `public-invite` is server-rendered
 * (`docs/FRONTEND/07`) and an id generated with `Math.random()` differs between the
 * server render and the client hydration, which detaches the label from its input on
 * exactly the surface where nobody would notice.
 */
export function useFieldId(provided?: string): string {
  const generated = reactUseId();
  return provided ?? generated;
}
