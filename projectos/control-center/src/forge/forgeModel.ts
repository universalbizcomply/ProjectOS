/**
 * Forge Console view model — read-only mirror of a Forge run (F1–F6) for the Control Centre.
 *
 * The Forge backend (`projectos/forge/*.cjs`) is CommonJS/Node and can't be imported in the browser; this
 * module mirrors the SHAPES with deterministic synthetic runs so the owner can watch a build. In the
 * desktop build these are replaced by live values from the local worker. Pure, deterministic, offline —
 * no backend, no network, no execution. Owner-only actions are surfaced as inert chips.
 * Created in PROJECTOS-FORGE-COMMAND-UI1A.
 */
import type { OwnerSafetyState, OwnerBadge } from '../owner/ownerModel';

export type VerifyKind = 'build' | 'unit' | 'route-smoke' | 'wired';

export interface ForgeIntegration {
  readonly id: string;
  readonly ownerGated: boolean;
}

export interface ForgeVerify {
  readonly kind: VerifyKind;
  readonly passed: boolean;
}

export interface ForgeSnapshot {
  readonly id: string;
  readonly label: string;
}

export interface ForgeRun {
  readonly commandId: string;
  readonly command: string;
  readonly projectName: string;
  readonly stack: string;
  readonly pages: readonly string[];
  readonly entities: readonly string[];
  readonly integrations: readonly ForgeIntegration[];
  readonly refused: readonly string[];
  readonly scaffoldFiles: readonly string[];
  readonly budgetCap: number;
  readonly spent: number;
  readonly verification: readonly ForgeVerify[];
  readonly snapshots: readonly ForgeSnapshot[];
  readonly ownerActions: readonly string[];
  readonly safety: OwnerSafetyState;
}

const SAFE: OwnerSafetyState = { productionFrozen: true, providerContacted: false, secretCapabilityUsed: false, apiUsed: false };
const OWNER_ACTIONS: readonly string[] = ['Provision (install + migrate + run)', 'Deploy', 'Add real provider key', 'Push to git'];

const BOOKING: ForgeRun = {
  commandId: 'booking',
  command: 'a booking app for a salon with stripe payments, email reminders and customer accounts',
  projectName: 'A Booking App',
  stack: 'next + supabase + tailwind + shadcn',
  pages: ['Book (/)', 'Schedule (/admin)'],
  entities: ['Booking'],
  integrations: [{ id: 'auth', ownerGated: false }, { id: 'payments', ownerGated: true }, { id: 'email', ownerGated: true }],
  refused: [],
  scaffoldFiles: [
    'package.json', 'app/layout.tsx', 'app/page.tsx', 'app/admin/page.tsx', 'app/api/booking/route.ts',
    'lib/supabase/server.ts', 'lib/supabase/client.ts', 'lib/supabase/request.ts',
    'supabase/migrations/0001_init.sql', '.env.example', '.projectops/config.json', 'forge.config.json',
  ],
  budgetCap: 100000,
  spent: 42000,
  verification: [{ kind: 'build', passed: true }, { kind: 'unit', passed: true }, { kind: 'route-smoke', passed: true }, { kind: 'wired', passed: true }],
  snapshots: [{ id: 'snap_a1', label: 'scaffold' }, { id: 'snap_b2', label: 'booking feature' }],
  ownerActions: OWNER_ACTIONS,
  safety: SAFE,
};

const SHOP: ForgeRun = {
  commandId: 'shop',
  command: 'an online store to sell products with a cart, orders and an OpenAI chatbot',
  projectName: 'An Online Store',
  stack: 'next + supabase + tailwind + shadcn',
  pages: ['Catalog (/)', 'Cart (/cart)'],
  entities: ['Order', 'Product'],
  integrations: [{ id: 'auth', ownerGated: false }, { id: 'payments', ownerGated: true }],
  refused: ['ai-api'],
  scaffoldFiles: [
    'package.json', 'app/layout.tsx', 'app/page.tsx', 'app/cart/page.tsx',
    'app/api/order_/route.ts', 'app/api/product/route.ts', 'lib/supabase/server.ts', 'lib/supabase/client.ts',
    'lib/supabase/request.ts', 'supabase/migrations/0001_init.sql', '.env.example', '.projectops/config.json',
  ],
  budgetCap: 100000,
  spent: 71000,
  verification: [{ kind: 'build', passed: true }, { kind: 'unit', passed: true }, { kind: 'route-smoke', passed: true }, { kind: 'wired', passed: false }],
  snapshots: [{ id: 'snap_c3', label: 'scaffold' }],
  ownerActions: OWNER_ACTIONS,
  safety: SAFE,
};

export const FORGE_RUNS: readonly ForgeRun[] = [BOOKING, SHOP];

/** Deterministic keyword routing from a typed command to a synthetic run (offline demo of F1 intent). */
export function forgeRunForCommand(command: string): ForgeRun {
  const c = (command || '').toLowerCase();
  if (/shop|store|ecommerce|e-commerce|product|cart|order/.test(c)) return SHOP;
  return BOOKING;
}

export function budgetPercent(spent: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((spent / cap) * 1000) / 10);
}

export function verifyTone(passed: boolean): OwnerBadge['tone'] {
  return passed ? 'ok' : 'crit';
}

/** True only when every required check (build/unit/wired) passed — mirrors the F5 anti-Potemkin gate. */
export function isVerified(run: ForgeRun): boolean {
  const required: VerifyKind[] = ['build', 'unit', 'wired'];
  return required.every((k) => run.verification.some((v) => v.kind === k && v.passed));
}
