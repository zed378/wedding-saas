# @wi/worker

Background jobs, in three pools that scale independently (`docs/BACKEND/08-JOBS-WORKERS.md`).

| Pool      | Runs                                  | Why separate                                                                                                                                     |
| --------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `media`   | Image processing, malware scan        | CPU-heavy and hostile input — runs under hard CPU and memory limits so one crafted file cannot starve anything else (`docs/SECURITY/06` layer 6) |
| `general` | Email, cache invalidation, light jobs | Must not queue behind image processing                                                                                                           |
| `cron`    | Scheduled jobs                        | Single leader, so a second instance does not run the daily expiry job twice                                                                      |

Every job is idempotent, retries per the policy in `docs/ARCHITECTURE/07`, and lands in a
dead-letter queue rather than disappearing. Job payloads carry the originating `request_id`
so an upload can be traced from HTTP request to worker completion.

Commands are wired in `P0-15`.
