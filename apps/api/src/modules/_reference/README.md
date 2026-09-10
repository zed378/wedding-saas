# `_reference` — the shape every module copies

Not a feature. This is the `Controller -> Service -> Repository` layering from
`docs/ARCHITECTURE/01` § Layering made concrete, so a Phase 1 module has something to
copy instead of a paragraph to interpret.

## The layering, and why it is strict

| Layer      | May do                                           | May never do            |
| ---------- | ------------------------------------------------ | ----------------------- |
| Controller | Parse the request, delegate, shape the response  | Contain a business rule |
| Service    | Business rules, orchestration, **authorization** | Know about HTTP         |
| Repository | Data access                                      | Contain a business rule |

Authorization lives in the **service**, not the controller (`docs/SECURITY/04`
§ Implementation Principles 2). A controller check is bypassed the moment the service is
called from a job, another module, or a second controller. The service is the only place
every caller must pass through.

In Phase 1 the repository methods carry the ownership filter in the query itself —
`findOwned(id, userId)` rather than `findById(id)` — so that a non-owner and a
non-existent row are indistinguishable at the data layer, and the service cannot
accidentally return 403 (`docs/SECURITY/05`, ADR-018). `P0-11` builds that layer.

## Three controllers, three surfaces

One per surface, to show that the split is a routing fact rather than a convention.
They are registered **only outside production** — a reference endpoint on a live public
host is an unnecessary surface, however harmless its payload.

## Removal

Delete this module once a real module exists on each surface. It is scaffolding, and
scaffolding that outlives its purpose becomes something people work around.
