# Fieldwise — Farm Management System

Track **every tree, sheep, goat, and resource** on the farm as an individually
identified record, and log every input applied to it — water, manure, feed,
fertilizer, medicine, vaccinations, health checks, harvests — so each item
carries its full history and running totals.

Built with **Next.js 16 (App Router)** and **Firebase / Firestore**.

---

## What it does

- **Accounts.** Sign up and sign in with email + password (Firebase Auth),
  with password reset. Each account has its **own farm** — nobody sees anyone
  else's data. Sign out from the sidebar or *Settings → Account*. Uses the
  Firebase client SDK only (no Admin SDK / service account).
- **Every item has a unique ID.** Trees/crops get `TR-0001`, animals `AN-0001`,
  resources `RS-0001`. IDs are generated server-side with a race-free counter.
- **Each item accumulates the "stuff" added to it.** Logging 2,400 L of water
  against `TR-0001` updates that tree's running water total *and* appends a
  timestamped entry to its history. The same works for manure, feed, medicine,
  and so on.
- **Live dashboard.** Item counts, animal health, water/manure/feed used this
  week, items needing attention, and a farm-wide activity feed — all derived
  from real data.
- **Rich item records.** Every item opens as a record with tabs — **Overview**,
  **Log input**, **History**, **Tasks** — and quick actions at the top, so it's
  always clear where information lives and where to add more. The overview
  adapts to the type:
  - *Animals:* sex, purpose, breeding status with due date, **weight trend**
    (latest, change, sparkline), **family** (mother, father, offspring — all
    clickable), source and purchase price.
  - *Trees:* rootstock, spacing, irrigation, pollinator, organic flag, and
    **harvest vs. expected yield**.
  - *Resources:* capacity, **stock meter with reorder point**, supplier, unit cost.
  - Plus the map zones the item belongs to, notes, and per-input totals.
- **Edit anything after creation.** The same full form used to add an item
  edits it later (pencil in the record header or *Edit details*).
- **Custom fields.** Add your own label → value pairs to any item (ear-tag
  color, insurance no., GPS point…) — up to 30 per item.
- **Tasks & reminders.** Schedule vaccinations, feeding, watering, spraying,
  pruning, shearing, harvests… with a due date, priority, and repeat
  (daily → yearly). Tasks are grouped *Overdue / Today / This week / Later*,
  show up on the dashboard, in the bell menu, and on each item. Completing a
  repeating task schedules the next one, and vaccination / health-check /
  pruning tasks **log themselves onto the item** automatically.
- **Fields (plots) you can switch between.** Group items into fields
  (e.g. *West field · 24 ha*) and switch the active field from the sidebar (or
  the top bar on phones). The whole dashboard — items, stats, tasks, activity —
  scopes to the selected field, with an **All fields** view. Add fields from
  the switcher; edit or delete them from Settings or the map screen (a field
  that still has items can't be deleted).
- **Field map with named zones.** A guided 3-step editor: set the field's real
  dimensions, create **zones** (e.g. *North orchard*, *Sheep pasture*), then
  paint them onto the grid. Each zone has its own details — crop, variety,
  planting date, soil, irrigation, notes — and **linked items**, so a tree's or
  animal's record shows where it lives. Zone labels sit on the map; the side
  list shows each zone's area and % coverage. Unsaved changes are guarded.
- **Toasts for every action.** Adding, editing, deleting, logging, completing
  a task, or saving the map confirms with a toast.
- **Working Settings.** Rename the farm, set your name/role (they drive the
  greeting, sidebar, and avatar), pick an **accent color** that re-themes the
  whole app instantly, choose the language and the **currency** used for
  prices, and manage fields — all persisted.
- **Collapsible sidebar.** Collapse the sidebar to an icon rail for more room;
  the choice is remembered.
- **Multi-language + RTL.** Switch between **English, French, and Arabic**; the
  choice is remembered, and Arabic flips the whole interface to right-to-left.
- **Phone-ready.** On small screens the sidebar becomes a **bottom navigation
  bar** with a central add button and a **More** sheet, and every panel reflows.

## Data model (Firestore)

Every account's data lives under its own root, `farms/{uid}/…`:

```
farms/{uid}/fields/{fieldId}                   ← one document per plot (FD-0001, …)
      id, name, area, unit, note, createdAt, updatedAt
      map?: { width, height, unit, cols, rows,
              cells[],             ← zone id per grid cell ('' = empty)
              zones[] }            ← { id, name, kind, crop, variety, plantedAt,
                                       soil, irrigation, notes, itemIds[] }

farms/{uid}/items/{itemId}         ← one document per tree / animal / resource
  ├─ id, name, itemType, fieldId, species, breed, zone, status, quantity, unit,
  │   tagNumber, originDate, notes, totals, logCount, createdAt, updatedAt,
  │   profile?      { sex, purpose, reproStatus, dueDate, motherId, fatherId,
  │                   rootstock, irrigation, expectedYield, capacity,
  │                   currentLevel, reorderAt, supplier, unitCost, … }
  │   customFields? [{ key, value }]
  └─ logs/{logId}                  ← every input/event applied to this item
        id, itemId, kind, amount, unit, note, performedBy, appliedAt, createdAt,
        farmId              ← owner uid, so dashboard queries stay in one farm

farms/{uid}/tasks/{taskId}         ← reminders (TK-0001, …)
      id, title, type, dueDate, repeat, priority, itemId?, fieldId?, notes,
      done, doneAt, createdAt, updatedAt

farms/{uid}/meta/counters          ← per-prefix ID counters (TR / AN / RS / FD / TK)
```

Each item carries a `fieldId`; the dashboard scopes to a field by filtering on
it, and item counts per field are tallied on the fly. A task linked to an item
inherits that item's field.

`totals` is a per-kind rollup kept on the item (amount, count, lastAppliedAt) so
a record's history is summarized without re-reading every log. For `weight`
the rollup keeps the **latest** reading rather than a sum.

Deleting an item also deletes its logs and tasks and unlinks it from map zones.
Maps saved in the older one-kind-per-cell format are upgraded to zones
automatically when read.

## Getting started

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. **With no configuration it runs against an in-memory
demo store with no sign-in** (seeded with sample trees, sheep, a goat, and resources) so you can
click around immediately. The header shows a **"Demo data"** badge in this mode.
Data resets when the server restarts.

### Connect Firebase (accounts + persistent data)

The app uses the **Firebase client SDK only** — no Admin SDK or service
account. The browser signs in with Firebase Auth and reads/writes Firestore
directly; `firestore.rules` restrict every user to their own `farms/{uid}`.

1. In the Firebase console for your project:
   - **Build → Firestore Database → Create database.**
   - **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
2. **Project settings → General → Your apps → Web app (</>)** and copy the
   config into `.env.local` (template: `.env.local.example`):
   ```
   NEXT_PUBLIC_FIREBASE_API_KEY=…
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=…
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=…
   NEXT_PUBLIC_FIREBASE_APP_ID=…
   ```
3. Deploy the security rules and indexes — **required**, the default rules
   block all access:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```
4. Restart `pnpm dev`. You're sent to **/login**; create an account at
   **/signup**. New accounts start with an empty farm — *Settings → Data →
   Load sample farm* fills it with the demo data.

**How it fits together.** The UI keeps calling the same `/api/...` paths
through `apiFetch` (`lib/client-api.ts`). With Firebase configured those calls
are answered in the browser by the signed-in user's `FirestoreStore`
(`lib/firestore-store.ts`); without it they go to the Next.js route handlers
and the in-memory demo store.

### Optional: deploy rules & indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

- `firestore.rules` lets each signed-in user read and write only their own
  `farms/{uid}` subtree (and requires every log's `farmId` to be their uid).
- `firestore.indexes.json` declares the `logs` collection-group indexes
  (`farmId` + date) used by the dashboard. Until they're deployed the browser
  console logs a warning and the dashboard falls back to slower per-item reads.

## Languages

The UI ships in English, French, and Arabic (RTL). Every string lives in
`lib/i18n.ts` as a flat key→text map per locale, with English as the fallback.
To add a language: add its entry to `LOCALES`, add a translation map to `dict`,
and it appears in the switcher automatically. Numbers use Latin digits even in
Arabic for legibility next to units; dates follow the active locale.

## API

These are served by the Next.js route handlers in demo mode. With Firebase
configured, `apiFetch` answers the same paths in the browser against the
signed-in user's farm (plus `POST /api/demo-data` to load the sample farm).

| Method & path | Purpose |
| --- | --- |
| `GET /api/farm-items` | List items. Filters: `?type=tree\|animal\|resource`, `?q=search`, `?field=FD-0001` |
| `POST /api/farm-items` | Register an item (ID generated; accepts `fieldId`). Returns `201` |
| `GET /api/farm-items/:id` | One item plus its full log history |
| `PATCH /api/farm-items/:id` | Update any detail — status, field, quantity, `profile`, `customFields` (send `[]` to clear), … |
| `DELETE /api/farm-items/:id` | Delete the item and all of its logs |
| `GET /api/farm-items/:id/logs` | List every log for an item |
| `POST /api/farm-items/:id/logs` | Record an input (water, feed, medicine, …). Returns `201` |
| `GET /api/fields` | List fields, each with its item count |
| `POST /api/fields` | Create a field. Returns `201` |
| `PATCH /api/fields/:id` | Update a field's name/area/note or save its map |
| `DELETE /api/fields/:id` | Delete a field (only when it has no items → `409`) |
| `GET /api/stats` | Aggregate figures for the dashboard. Scope with `?field=FD-0001` |
| `GET /api/tasks` | List tasks. Filters: `?status=open\|done\|all`, `?field=FD-0001`, `?item=AN-0001` |
| `POST /api/tasks` | Schedule a task (title, type, dueDate, repeat, priority, itemId, fieldId, notes). Returns `201` |
| `PATCH /api/tasks/:id` | Edit a task, or reopen it with `{"done": false}` |
| `DELETE /api/tasks/:id` | Delete a task |
| `POST /api/tasks/:id/complete` | Complete a task → returns `{ task, next?, logged }` (next occurrence for repeating tasks; `logged` when an entry was added to the item) |

Example — log 1,200 L of water against a tree:

```bash
curl -X POST http://localhost:3000/api/farm-items/TR-0001/logs \
  -H 'Content-Type: application/json' \
  -d '{"kind":"water","amount":1200,"unit":"L","note":"Weekly irrigation"}'
```

Example — a yearly vaccination reminder for an animal:

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Booster vaccination","type":"vaccination","dueDate":"2026-10-01","repeat":"yearly","priority":"high","itemId":"AN-0001"}'
```

## Project layout

```
app/
  page.tsx                     App shell: navigation, dashboard, assets, map,
                               reports, settings screens
  login/, signup/              Sign-in and sign-up pages
  api/farm-items/route.ts      List + create items
  api/farm-items/[id]/route.ts Get + update + delete one item
  api/farm-items/[id]/logs/    List + add logs for an item
  api/fields/                  List + create fields
  api/fields/[id]/route.ts     Update (incl. map) + delete a field (guarded)
  api/tasks/                   List + create tasks
  api/tasks/[id]/route.ts      Update + delete a task
  api/tasks/[id]/complete/     Complete a task (repeat + auto-log)
  api/stats/route.ts           Dashboard aggregates
lib/
  farm-types.ts                Domain types + shared constants
  farm-store.ts                Store interface, shared logic, memory store
  map-utils.ts                 Map zone helpers + legacy map upgrade
  firebase-client.ts           Browser Firebase init (Auth + Firestore)
  firestore-store.ts           Firestore store (client SDK, one farm per user)
  client-api.ts                apiFetch: /api/... → Firestore or the demo server
  validate.ts                  Request-body validation
  api.ts                       Route error handling helpers
  ui.ts                        Icons, formatting, due dates, unit labels
  i18n.ts                      Translations (en / fr / ar) + translate()
components/
  auth-form.tsx                Sign in / sign up / reset-password form
  auth-provider.tsx            Firebase Auth state (useAuth) + sign out
  item-drawer.tsx              The item record (overview, log, history, tasks)
  item-form.tsx                Add / edit item form (profile + custom fields)
  tasks.tsx                    Tasks screen, task form, bell, upcoming panel
  field-map.tsx                The field map + zone editor
  field-form.tsx               Add / edit / delete a field
  form-kit.tsx                 Shared form sections and inputs
  data-hooks.ts                SWR data hooks + global refresh
  meta-line.tsx                "a · b · c" lines that stay readable in RTL
  language-provider.tsx        Language context, hook, and persistence
  settings-provider.tsx        Farm/manager/accent/currency settings (persisted)
  toast-provider.tsx           Toast notifications
firestore.rules                Security rules (each user → own farm only)
firestore.indexes.json         Collection-group indexes
```
# farm-managment
