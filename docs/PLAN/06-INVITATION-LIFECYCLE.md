# 06 - Invitation Lifecycle

## State Machine

```
            create
              │
              ▼
          ┌────────┐
          │ draft  │◄────────────────────────┐
          └───┬────┘                         │
              │ checkout                     │ refund (admin)
              ▼                              │
     ┌────────────────┐                      │
     │ pending_payment │──payment_failed/────┘
     └────────┬────────┘   expired (auto)
              │ payment webhook confirmed
              ▼
          ┌───────┐
          │ paid  │◄─────────────┐
          └───┬───┘              │
              │ publish            │ unpublish
              ▼                    │
        ┌───────────┐              │
        │ published │──────────────┘
        └─────┬─────┘
              │ expiry_date passed (cron/job)
              ▼
         ┌─────────┐   renew (payment)   
         │ expired │────────────────────► published (expiry_date extended)
         └────┬────┘
              │ 90 days without renewal
              ▼
         ┌───────────┐
         │ soft_deleted │
         └─────┬───────┘
               │ another 30 days (job)
               ▼
          hard_deleted (permanent)
```

## State Definitions
| State | Publicly accessible? | Editable? |
|---|---|---|
| `draft` | No | Yes, freely |
| `pending_payment` | No | Yes (still allowed to edit while awaiting payment) |
| `paid` | No | Yes |
| `published` | Yes | Yes (changes go live immediately) |
| `expired` | No (shows an "invitation has ended" page) | Yes (for renewal/editing before renewal) |
| `soft_deleted` | No | No (read-only, restorable by an admin during the retention period) |
| `hard_deleted` | No | No (data deleted) |

## Transition Rules
- All transitions are logged in `invitation_status_history` (audit trail) — see DATABASE/10-AUDIT-LOGS.md.
- The `pending_payment → paid` transition ONLY occurs through the validated payment webhook processing job (see BACKEND/05-PAYMENT-FLOW.md).
- The `published → expired` transition is run by a scheduled daily job (see BACKEND/08-JOBS-WORKERS.md), not on-the-fly during a request.
- Backward transitions are only performed by admins (refund cases) and must include a reason. A refund sets the invitation to `draft` from whatever state it held, including directly from `published` — the public page stops being served immediately and the cache is invalidated rather than left to expire (BR-5.4, BACKEND/05 § Refund).
- Unpublish is a user's own action: `published → paid` (not `draft`, since it was already paid for), and they can republish anytime without paying again.
