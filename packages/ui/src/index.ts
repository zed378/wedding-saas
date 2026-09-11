/**
 * `@wi/ui` — the application design system. `docs/UI-UX/06`.
 *
 * Built by `P0-22` so that no Phase 1 screen invents a button. Everything here is
 * **application chrome** — the dashboard, editor, checkout and admin. The invitation
 * itself is rendered by `@wi/template-renderer` from per-template theme data
 * (`docs/PLAN/07`), and nothing in this package may reach it: if it did, every template
 * would inherit the dashboard's indigo.
 *
 * The tokens are CSS, not TypeScript. Import them once per app:
 *
 *   @import "@wi/ui/tokens.css";
 *
 * Tailwind v4 turns that `@theme` block into both the custom properties and the utility
 * classes, so there is one declaration of every colour, size and spacing value in the
 * product and no way for a class name and a variable to disagree.
 */

export { cx, type ClassValue } from "./cx.js";
export { useFieldId } from "./useId.js";

export { Button, type ButtonProps } from "./components/Button.js";
export {
  buttonClassName,
  type ButtonVariant,
  type ButtonSize,
} from "./components/button-class.js";
export { Spinner } from "./components/Spinner.js";
export {
  Field,
  fieldWiring,
  type FieldOwnProps,
  type FieldWiring,
} from "./components/Field.js";
export { Input, type InputProps } from "./components/Input.js";
export { Textarea, type TextareaProps } from "./components/Textarea.js";
export {
  Select,
  type SelectProps,
  type SelectOption,
} from "./components/Select.js";
export { Modal, type ModalProps, type ModalSize } from "./components/Modal.js";
export {
  ToastProvider,
  useToast,
  type Toast,
  type ToastApi,
  type ToastVariant,
} from "./components/Toast.js";
export {
  Badge,
  InvitationStatusBadge,
  INVITATION_STATUS_PRESENTATION,
  type BadgeProps,
  type BadgeTone,
  type InvitationStatus,
  type InvitationStatusBadgeProps,
} from "./components/Badge.js";
export { Card, CardHeader, type CardProps } from "./components/Card.js";
export {
  InteractiveCard,
  type InteractiveCardProps,
} from "./components/InteractiveCard.js";
export { Tabs, type TabsProps, type TabItem } from "./components/Tabs.js";
export {
  Table,
  type TableProps,
  type TableColumn,
  type SortDirection,
} from "./components/Table.js";
export { Stepper, type StepperProps, type Step } from "./components/Stepper.js";
export { Skeleton, SkeletonList } from "./components/Skeleton.js";
export { Dropzone, type DropzoneProps } from "./components/Dropzone.js";
export {
  Avatar,
  type AvatarProps,
  type AvatarSize,
} from "./components/Avatar.js";
