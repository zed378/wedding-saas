# 05 - Media Handling (Frontend)

## Upload Flow (Client)
1. The user selects/drags a file → quick client-side validation (extension, size) as early UX feedback (NOT a replacement for server-side validation, see SECURITY/06).
2. Show an instant local preview (`URL.createObjectURL`) before the upload completes — a responsive UX.
3. Upload via `POST /invitations/:id/media` (multipart) with progress tracking (`onUploadProgress`).
4. After the initial response (`status: processing`), poll `GET /media/:id` or listen for an event (if a WebSocket/SSE exists) until `status: ready`.
5. Once `ready`, replace the local preview with the actual CDN URL & update the editor state (`media_id`, `url`).
6. If it fails (validation/error), show a specific error message & let the user retry without losing context (other fields aren't reset).

## Gallery Manager Component
- Multi-file drag-drop upload with a queue (sequential/limited-parallel uploads, e.g., max 3 concurrent, to avoid overloading the user's connection).
- Reorder via drag (e.g., `@dnd-kit`), emit `POST /gallery/reorder` after a drop (debounced if reordering happens quickly in succession).
- A delete button per photo with a light confirmation (a 3-second undo toast before it's actually deleted from the server, optional).

## Image Optimization on the Client Side
- Use the framework's `<Image>` component (Next.js Image or an equivalent) for lazy-loading, responsive `srcset` from the CDN variants already generated server-side (thumbnail/medium/large).
- Public Invitation page: prioritize loading the cover photo (an LCP candidate) with `priority`/eager loading, lazy-loading the rest as they enter the viewport.

## Map Picker Component
- An embedded interactive map (Google Maps JS API/Leaflet+OSM), a draggable pin to set coordinates, synced with the text address input (optional reverse geocoding).
- Emits `latitude`, `longitude` to the form state; the backend generates the `maps_url` (see DATABASE/05).
