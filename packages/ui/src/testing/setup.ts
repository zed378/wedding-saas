import "@testing-library/jest-dom/vitest";

/**
 * P0-22 — the `<dialog>` polyfill, and what it does not prove.
 *
 * jsdom 30 parses `<dialog>` and honours its `open` attribute, but implements neither
 * `showModal()` nor `close()`. Without them `Modal` throws on mount and every one of its
 * tests fails on the test environment rather than on the component.
 *
 * ## What this gives back
 *
 * Only the `open` attribute and the `close` event. That is enough to assert the things
 * a unit test should assert: the dialog is exposed with `role="dialog"` when open and
 * absent when closed, it is named by its title and described by its description, and the
 * close control routes through `onClose` rather than closing the element behind the
 * caller's back.
 *
 * ## What it cannot prove, and where that is covered
 *
 * The four reasons `Modal` uses the platform element are all browser behaviours that no
 * polyfill reproduces:
 *
 *   1. **Focus is trapped** inside the dialog.
 *   2. **The rest of the page is inert** — not merely covered.
 *   3. **Escape fires `cancel`.**
 *   4. **It renders in the top layer**, above every stacking context.
 *
 * A green suite in this file says nothing about any of them. They are exercised by the
 * workbench E2E pass (`e2e/tests/workbench.e2e.ts`), which drives a real browser.
 *
 * This note exists because a polyfill that quietly makes tests pass is how a component
 * ends up trusted for a property nothing ever checked.
 */
if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    show?: () => void;
    close?: (returnValue?: string) => void;
  };

  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }

  if (typeof proto.show !== "function") {
    proto.show = function show(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }

  if (typeof proto.close !== "function") {
    proto.close = function close(
      this: HTMLDialogElement,
      returnValue?: string,
    ) {
      this.removeAttribute("open");
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.dispatchEvent(new Event("close"));
    };
  }
}
