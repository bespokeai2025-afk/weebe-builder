# WebEspoke AI Builder

**WebEspoke** is a SaaS platform for building, deploying, and monitoring AI-powered voice agents. It combines a visual conversation-flow editor with Retell AI telephony, Cal.com calendar booking, and comprehensive call analytics — all within a multi-tenant workspace architecture.

---

## Features

### Visual Flow Builder

Drag-and-drop node editor using `@xyflow/react` to design conversational scripts. Build complex agent behaviors with branching logic, function calls, and transfer nodes — no coding required.

### Agent Management

Save, load, and deploy voice agents from the builder. Each agent tracks call duration and cost history. Deploy to Retell AI with one click, supporting both development and production Retell workspaces.

### Agent Templates

Browse global and personal reusable templates. Clone any template directly into the builder to use as a starting point for new agents.

### Outbound Calling

Import CSV data records, assign voice agents, and schedule batch outbound campaigns. Track delivery status, call outcomes, and lead qualification in real time.

### Call Analytics

Dashboard with per-agent breakdown of call volume, duration, cost, sentiment, success rate, and latency. Includes full call recording playback with transcript-style logs.

### Calendar Integration

Connect Google Calendar or Outlook via Cal.com. Agents can check availability, book appointments, reschedule, and cancel — all through natural conversation. Sync calendars and event types automatically.

### WhatsApp Messaging

View inbound and outbound WhatsApp conversations. Integrates with Retell AI for messaging workflows.

### Billing & Usage

Stripe-powered subscription management with tiered pricing plans. Track test-call spend caps and usage per user.

### Multi-Tenant Workspaces

Workspace-based isolation with role-based access (owner, admin, member). Invite collaborators, manage API tokens, and scope all resources per workspace.

### Admin Panel

Platform administration tools: user management, spend credits, activity monitoring.

---

## Tech Stack

| Layer          | Technology                                                |
| -------------- | --------------------------------------------------------- |
| **Framework**  | React 19, TanStack Router, TanStack Start, TanStack Query |
| **Styling**    | Tailwind CSS 4, Radix UI, shadcn/ui, Lucide icons         |
| **Database**   | Supabase (PostgreSQL, RLS, real-time)                     |
| **Auth**       | Supabase Auth, JWT-based middleware, Bearer tokens        |
| **AI/Voice**   | Retell AI SDK, custom conversation-flow protocol          |
| **Calendar**   | Cal.com API (REST), Google Calendar, Outlook              |
| **Payments**   | Stripe (embedded checkout, portal, webhooks)              |
| **Email**      | Lovable email service, React Email templates              |
| **Charts**     | Recharts                                                  |
| **Validation** | Zod                                                       |
| **State**      | Zustand (builder store), TanStack Query (server state)    |
| **Build**      | Vite, Cloudflare Workers, `bun`                           |

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                      Web Browser                           │
│  TanStack Router · TanStack Query · Zustand · Radix UI    │
└────────────────────────┬───────────────────────────────────┘
                         │ Server Functions (RPC)
                         ▼
┌────────────────────────────────────────────────────────────┐
│                   TanStack Start (Vite)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Auth        │  │ Domain       │  │ API Routes       │ │
│  │ Middleware   │  │ Functions    │  │ (Webhooks)       │ │
│  └─────────────┘  └──────────────┘  └──────────────────┘ │
└────────────────────────┬───────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Supabase   │ │   Retell AI  │ │   Stripe     │
│  PostgreSQL  │ │  Voice API   │ │  Payments    │
│  Auth + RLS  │ │  Telephony   │ │   Billing    │
└──────────────┘ └──────────────┘ └──────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │   Cal.com    │
                  │  Scheduling  │
                  └──────────────┘
```

### Server Functions

All data operations use TanStack Start server functions with typed RPC. The server-side `requireSupabaseAuth` middleware validates JWT tokens and resolves the active workspace context before each handler executes.

### Workspace Isolation

Every resource (agents, calls, leads, calendar settings, API tokens) is scoped to a workspace. The auth middleware extracts the workspace ID from a cookie or profile default, ensuring cross-tenant isolation.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) or [pnpm](https://pnpm.io)
- Supabase project (self-hosted or cloud)
- Retell AI account and API key
- Cal.com account (for booking features)
- Stripe account (for billing)

### Environment Setup

```bash
cp .env.example .env
```

Fill in your credentials. Required variables:

| Variable                        | Description                                      |
| ------------------------------- | ------------------------------------------------ |
| `SUPABASE_URL`                  | Supabase project URL                             |
| `SUPABASE_PUBLISHABLE_KEY`      | Anon/publishable key                             |
| `SUPABASE_SERVICE_ROLE_KEY`     | Service role key (admin operations)              |
| `VITE_SUPABASE_URL`             | Client-accessible Supabase URL                   |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client-accessible publishable key                |
| `VITE_PAYMENTS_CLIENT_TOKEN`    | Stripe publishable key                           |
| `STRIPE_SANDBOX_API_KEY`        | Stripe secret key (sandbox)                      |
| `RETELL_API_KEY`                | Retell AI API key                                |
| `PUBLIC_SITE_URL`               | Public site URL for agent registration callbacks |

### Database

```bash
# Link your Supabase project
supabase link --project-ref <project-id>

# Apply all migrations
supabase db push
```

All 25 database migrations are in `supabase/migrations/`. They cover the full schema: workspaces, agents, calls, leads, bookings, calendar connections, billing, email infrastructure, and more.

### Seed Data

After migrations are applied, seed the database with default data:

```bash
# Seed the admin user (used for template management & user approvals)
SEED_ADMIN_EMAIL=admin@webespokeai.com npx tsx scripts/seed-admin.ts
```

**Test credentials:**

| Field    | Value                    |
| -------- | ------------------------ |
| Email    | `admin@webespokeai.com`  |
| Password | `admin123`               |

The admin account can manage global templates, approve user sign-ups, and access the admin panel at `/admin`.

### Development

```bash
# Install dependencies
bun install

# Start dev server
bun run dev
```

The development server starts on `http://localhost:3000` by default.

### Build & Deploy

```bash
# Build for production
npm run build

# Run production server locally (Node + srvx)
npm run start
```

Production deploys to EC2 via GitHub Actions on every merge to `main`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for server setup, secrets, and systemd/nginx configuration.

The codebase also supports Cloudflare Workers via `@cloudflare/vite-plugin` and `wrangler.jsonc`; EC2 uses the Node SSR bundle in `dist/`.

---

## Project Structure

```
src/
├── components/           # UI components (shadcn/ui, sidebar, layout)
├── integrations/         # External service clients
│   └── supabase/
│       ├── client.ts           # Browser Supabase client
│       ├── client.server.ts    # Server admin client
│       ├── auth-middleware.ts   # JWT + workspace resolution
│       ├── auth-attacher.ts     # Client-side token attacher
│       └── types.ts             # Generated database types
├── lib/                  # Domain modules
│   ├── agents/           # Agent CRUD, templates
│   ├── auth/             # Auth helpers, admin guards
│   ├── billing/          # Stripe billing, plans
│   ├── builder/          # Flow builder store, types, Retell integration
│   ├── calendar/         # Calendar settings, Cal.com API, booking tools
│   ├── dashboard/        # Analytics, leads, calls, data records
│   ├── email/            # Email sending
│   ├── providers/        # Retell HTTP client, Cal.com webhooks
│   └── workspace/        # Workspace CRUD, invites, API tokens
├── routes/               # TanStack Router file-based routes
│   ├── __root.tsx                 # Root shell, theme, error boundary
│   ├── _authenticated.tsx         # Authenticated layout (sidebar)
│   ├── _authenticated/            # All app pages
│   │   ├── dashboard.tsx
│   │   ├── my-agents.tsx
│   │   ├── builder.tsx
│   │   ├── templates.tsx
│   │   ├── leads.tsx / calls.tsx / calendar.tsx / ...
│   │   ├── billing.tsx
│   │   └── admin.tsx              # Admin panel
│   ├── login.tsx / signup.tsx
│   ├── index.tsx          # Landing page
│   └── api/               # Public and admin API routes
└── server.ts             # Cloudflare Workers entry point
```

---

## Scripts

| Command           | Description              |
| ----------------- | ------------------------ |
| `bun run dev`     | Start development server |
| `bun run build`   | Production build         |
| `bun run preview` | Preview production build |
| `bun run lint`    | Run ESLint               |
| `bun run format`  | Format with Prettier     |

---

## License

Private — All rights reserved.
