import { Component, type ErrorInfo, type ReactNode } from "react";

import type { SectionErrorReport } from "./types.js";

/**
 * P2-04 — the section-level boundary. `docs/FRONTEND/08` § Boundary Levels, innermost.
 *
 * ## What this is protecting
 *
 * `docs/FRONTEND/08` is specific about why the section level exists and it is not
 * generic robustness: *"RSVP/event info is the most important function and must never
 * disappear because another section broke."* A corrupt gallery row taking down the page
 * means a guest cannot find the venue or confirm attendance — on a page hundreds of
 * people open from a WhatsApp link, at a time nobody is watching a dashboard.
 *
 * ## Why a class component
 *
 * React has no hook for this. `componentDidCatch` and `getDerivedStateFromError` exist
 * only on classes, and every "error boundary hook" library is a class underneath. This is
 * the one place in the codebase where a class is not a style choice.
 *
 * ## It renders nothing on failure, not an apology
 *
 * `docs/FRONTEND/08` allows "hidden or shows a subtle placeholder". Hidden is the right
 * default here: a guest who never knew the gallery existed is not served by being told it
 * is broken, and an error box in the middle of a wedding invitation is worse for the
 * couple than a missing section. The caller can pass a `fallback` where that judgement
 * differs — the editor does, because there the couple **is** the person who needs to know.
 */

interface Props {
  readonly sectionKey: string;
  readonly component: string;
  readonly onError?: ((report: SectionErrorReport) => void) | undefined;
  /** What to show instead. Nothing, by default. */
  readonly fallback?: ReactNode;
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
}

export class SectionBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /**
     * `docs/FRONTEND/08` § Logging asks for `invitation_id`, `section_key` and `user_id`
     * — and explicitly **without** sensitive data, "aligned with SECURITY/09".
     *
     * This reports the section key, the component name and the error's own message and
     * stack. It does **not** report the section's data, and that is the decision worth
     * stating: the obvious thing to attach to a render error is the props that caused it,
     * and for this renderer those props can be bank account numbers (`docs/SECURITY/09`)
     * or a guest list. An error tracker is not a system anyone approved for that.
     *
     * `invitation_id` is added by the caller, which is the layer that knows it. Keeping it
     * out of this package is deliberate: the renderer has no concept of which invitation
     * it is showing, and giving it one would be the first step to it behaving differently
     * for some of them.
     */
    this.props.onError?.({
      sectionKey: this.props.sectionKey,
      component: this.props.component,
      message: error.message,
      componentStack: info.componentStack ?? undefined,
    });
  }

  override render(): ReactNode {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
