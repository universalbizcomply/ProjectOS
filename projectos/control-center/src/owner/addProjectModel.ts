/**
 * The rules behind Add Project, kept out of the component so they can be tested.
 *
 * WHAT THE OWNER SHOULD NEVER HAVE TO KNOW. A project id, a credential reference, an environment
 * name, or which of the values a service asks for is a secret. All four are decided here, from a
 * project NAME and a chosen FOLDER, which are the only two things the owner actually supplies.
 *
 * Created in PROJECTOS-SIMPLE-PROJECT-WIZARD1A.
 */

/** How a value must be handled. The owner sees the consequence, never the word. */
export type ValueKind = 'secret' | 'config' | 'optional';

export interface ConnectionField {
  readonly key: string;
  readonly label: string;
  readonly kind: ValueKind;
  /** One short line under the input. Absent when the label is self-evident. */
  readonly hint?: string;
}

export interface ConnectionKind {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly ConnectionField[];
  /** A custom connection has no fixed fields — the owner names its own. */
  readonly custom?: boolean;
}

/**
 * The services this machine's projects actually use, and WHICH of their values is dangerous.
 *
 * The classification is the point. Treating every value as a secret trains an owner to paste
 * anything into a masked box, and hides the one field that genuinely must never be seen again. A
 * Supabase project URL is printed in the client bundle; a service-role key is a master credential.
 */
export const CONNECTION_CATALOGUE: readonly ConnectionKind[] = [
  { id: 'openai', label: 'OpenAI', fields: [{ key: 'api-key', label: 'API key', kind: 'secret' }] },
  { id: 'anthropic', label: 'Anthropic', fields: [{ key: 'api-key', label: 'API key', kind: 'secret' }] },
  { id: 'github', label: 'GitHub', fields: [{ key: 'token', label: 'Access token', kind: 'secret' }] },
  {
    id: 'supabase',
    label: 'Supabase',
    fields: [
      { key: 'project-url', label: 'Project URL', kind: 'config', hint: 'Safe to share. It appears in your app.' },
      { key: 'anon-key', label: 'Anon / public key', kind: 'config', hint: 'Safe to share. Protected by your row-level rules.' },
      { key: 'service-key', label: 'Service role key', kind: 'secret', hint: 'Full access to your data. Stored securely and never shown again.' },
    ],
  },
  {
    id: 'vercel',
    label: 'Vercel',
    fields: [
      { key: 'project-id', label: 'Project ID', kind: 'config' },
      { key: 'org-id', label: 'Organisation ID', kind: 'config' },
      { key: 'token', label: 'Token', kind: 'secret' },
    ],
  },
  { id: 'stripe', label: 'Stripe', fields: [{ key: 'secret-key', label: 'Secret key', kind: 'secret' }] },
  { id: 'resend', label: 'Resend', fields: [{ key: 'api-key', label: 'API key', kind: 'secret' }] },
  {
    id: 'twilio',
    label: 'Twilio',
    fields: [
      { key: 'account-sid', label: 'Account SID', kind: 'config' },
      { key: 'auth-token', label: 'Auth token', kind: 'secret' },
    ],
  },
  { id: 'custom', label: 'Other', fields: [], custom: true },
];

/**
 * A project id, derived from the name the owner typed.
 *
 * The owner is never asked to invent one. Lowercase, spaces and punctuation collapsed to single
 * hyphens, trimmed — "ERP System" becomes "erp-system", which is exactly what that project's own
 * configuration already declares. Empty in, empty out: the caller decides what to do about it
 * rather than receiving a plausible-looking id for a name that was never given.
 */
export function projectIdFrom(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Join a chosen parent folder and a project name into the folder that will be created.
 *
 * The NAME is used verbatim, not the id: a folder called "ERP System" is what the owner will look
 * for on disk, and silently creating "erp-system" instead is the kind of small betrayal that makes
 * a tool feel untrustworthy.
 */
export function newProjectPath(parent: string, name: string): string {
  const base = parent.replace(/[\\/]+$/, '');
  const leaf = name.trim();
  if (base === '' || leaf === '') return '';
  return `${base}\\${leaf}`;
}

/** The credential reference the store expects. The owner never sees or types this. */
export function credentialReference(
  projectId: string,
  environment: string,
  provider: string,
  credential: string,
): string {
  return `ProjectOS/${projectId}/${environment}/${provider}/${credential}`;
}

/** One value the owner filled in, ready to be stored. */
export interface PendingValue {
  readonly provider: string;
  readonly key: string;
  readonly label: string;
  readonly kind: ValueKind;
  readonly value: string;
}

/**
 * Which values are worth storing.
 *
 * Blank rows are dropped rather than stored as empty strings — an empty credential reads as
 * "configured" everywhere downstream and fails much later, somewhere that cannot explain itself.
 */
export function valuesToStore(pending: readonly PendingValue[]): readonly PendingValue[] {
  return pending.filter((p) => p.value.trim() !== '' && p.provider.trim() !== '' && p.key.trim() !== '');
}

/** What the review step says about a connection, without ever quoting a value. */
export function connectionSummary(provider: string, values: readonly PendingValue[]): string {
  const mine = valuesToStore(values).filter((v) => v.provider === provider);
  if (mine.length === 0) return 'Nothing entered';
  const secrets = mine.filter((v) => v.kind === 'secret').length;
  const config = mine.length - secrets;
  const parts: string[] = [];
  if (secrets > 0) parts.push(`${secrets} stored securely`);
  if (config > 0) parts.push(`${config} setting${config === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
