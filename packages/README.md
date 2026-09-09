# packages/

Code shared between the five surfaces in `apps/`.

| Package             | Purpose                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `schema`            | Zod schemas, the canonical field-path registry, the dot-notation resolver |
| `template-renderer` | The generic renderer and section components                               |
| `ui`                | Design tokens and components; React Email templates                       |
| `api-client`        | Typed API client with the interceptor behaviour from `docs/FRONTEND/08`   |
| `config`            | Shared tsconfig, eslint, prettier                                         |

`schema` and `template-renderer` are the two that justify the monorepo. `schema` is imported by
the API (publish validation) and by the editor (the completeness checklist) so the two cannot
drift. `template-renderer` is imported by the editor preview and the public page so they render
identically. Both properties are structural here and would be a matter of discipline otherwise.
