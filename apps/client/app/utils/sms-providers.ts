/**
 * Who carries a project's one-time codes, where each country's messages go, and what one
 * costs (PROJECT.md 4.8, 5.1, 11.1).
 *
 * The screen this backs exists because of one line in the price list: SMS is regional
 * wholesale plus twenty-five percent, "displayed transparently per country in the
 * dashboard". A channel that bills per message and hides the per-message price is a
 * channel nobody can budget for, so the table is the point of the screen and everything
 * else is context for it.
 *
 * The panel decides nothing here. The route for a country, the wholesale behind it and
 * which vendors are live are the deployment's, served with the project; this file is that
 * table as the panel receives it, plus the arithmetic that turns a wholesale into the
 * price a customer pays. A screen that picked its own route would show a vendor the
 * router will not use.
 *
 * The other half is the choice a project does make: our routing, or an account of their
 * own. Bringing your own Twilio or Vonage is free and always will be, because at that
 * point we are not buying the message.
 */

/*
 * The vendors.
 */

export type SmsProviderId =
  | "twilio"
  | "aws"
  | "vonage"
  | "msg91"
  | "regional"
  | "whatsapp"
  | "logging";

/**
 * Whether the vendor carries traffic on this deployment today.
 *
 * `live` is reserved for an adapter that is actually wired and dispatching. Every vendor
 * here is a port with no implementation behind it, so nothing is `live` and nothing may
 * be drawn as though it were: the route table is what the router *would* choose, and the
 * only thing that carries a message today is the logging transport
 * (notes/sms-providers.md P1). A state that outran the deployment is the one claim this
 * screen must not make, because it is unfalsifiable from the panel and a customer would
 * only find out on somebody's sign-in.
 */
export type ProviderState = "live" | "planned" | "development";

export const PROVIDER_STATE_LABELS: Record<ProviderState, string> = {
  live: "Carrying traffic",
  planned: "Not wired yet",
  development: "Development only",
};

export interface SmsProviderInfo {
  id: SmsProviderId;
  label: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** What it is for, in the router's terms: primary, failover, one country, one channel. */
  role: string;
  state: ProviderState;
  note: string;
}

export const SMS_PROVIDERS: readonly SmsProviderInfo[] = [
  {
    id: "twilio",
    label: "Twilio Programmable SMS",
    icon: "material-symbols:cell-tower",
    role: "Primary, global reach",
    state: "planned",
    note: "Reaches every country we sell into, which is why it is the default route and the one every other vendor is measured against on price. Programmable SMS only: we generate the code ourselves rather than paying about five cents a verification for Twilio Verify.",
  },
  {
    id: "aws",
    label: "AWS End User Messaging",
    icon: "material-symbols:cloud-outline",
    role: "Secondary, failover and cost",
    state: "planned",
    note: "The second route on most of the table. It is cheaper than Twilio in several regions and it is where traffic moves when Twilio's error rate rises, which is the only reason a project needs two vendors it never chose between.",
  },
  {
    id: "vonage",
    label: "Vonage",
    icon: "material-symbols:swap-horiz",
    role: "Alternate route",
    state: "planned",
    note: "A third route for the countries where the first two are both expensive. Also one of the two vendors a customer may bring an account of their own for.",
  },
  {
    id: "msg91",
    label: "MSG91",
    icon: "material-symbols:south-asia",
    role: "India",
    state: "planned",
    note: "India is the one market where a local vendor is decisively cheaper, because DLT registration is a domestic process and an international sender pays for the detour.",
  },
  {
    id: "regional",
    label: "Regional carriers",
    icon: "material-symbols:public",
    role: "Turkey and MENA",
    state: "planned",
    note: "Where Twilio's rate is several times a local carrier's. One integration per market, added when the volume in that market pays for the work.",
  },
  {
    id: "whatsapp",
    label: "WhatsApp Cloud API",
    icon: "material-symbols:chat-outline",
    role: "A channel of its own",
    state: "planned",
    note: "Roughly a fifth the price of SMS in most regions, which is why it is worth having at all. It sends pre-approved template messages rather than free text, so it is a provider and a template pipeline of its own and never a branch inside the SMS flow.",
  },
  {
    id: "logging",
    label: "Logging transport",
    icon: "material-symbols:terminal",
    role: "Development",
    state: "development",
    note: "Prints the whole message and refuses to construct outside development, so a misconfigured deployment cannot quietly send nothing and call it a success.",
  },
];

const PROVIDER_BY_ID = new Map(SMS_PROVIDERS.map((provider) => [provider.id, provider]));

export function providerInfo(id: SmsProviderId): SmsProviderInfo | null {
  return PROVIDER_BY_ID.get(id) ?? null;
}

export function providerLabel(id: SmsProviderId): string {
  return PROVIDER_BY_ID.get(id)?.label ?? id;
}

/** The vendors that would carry traffic if any of them were wired. Never `logging`. */
export const CARRIERS = SMS_PROVIDERS.filter((provider) => provider.state !== "development");

/** What actually dispatches on this deployment. Null once a real adapter is registered. */
export function liveTransport(): SmsProviderInfo | null {
  return SMS_PROVIDERS.find((provider) => provider.state === "live") ?? null;
}

/**
 * Whether anything on this deployment can hand a message to a carrier.
 *
 * False everywhere today, and the screen has to say so rather than drawing a route table
 * that reads as a working one. It is a fact about the deployment and not about a project,
 * so no setting on this screen changes it.
 */
export function transportWired(): boolean {
  return liveTransport() !== null;
}

/*
 * What a message costs.
 */

/** PROJECT.md 5.1. The whole of our margin on this channel. */
export const SMS_MARGIN = 0.25;

/**
 * What a message costs the customer, from what it costs us. Rounded to four decimals
 * because that is the resolution the wholesale rates themselves carry, and a price with
 * a floating-point tail in it reads as a mistake in a column of tidy figures.
 */
export function priceFor(wholesale: number): number {
  return Math.round(wholesale * (1 + SMS_MARGIN) * 10000) / 10000;
}

/**
 * A price as the table writes it. Four decimals everywhere rather than the fewest each
 * figure needs, so a column of them lines up on the point and a tenth of a cent is
 * visible where a country costs one.
 *
 * `formatMoney` in `./sms-policy` is the other voice for money on this channel and is
 * for a cap and a day's spend, which are read to the cent. A per-message price to the
 * cent is zero everywhere but the dearest country on the table.
 */
export function formatPrice(amount: number, currency = "USD"): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${amount.toFixed(4)}`;
}

/**
 * The segment sizes an SMS is billed in. Here because the price is per segment and not
 * per message: the 161st plain character costs a second segment, and one curly
 * apostrophe drops the whole message from 160 characters to 70. What a body actually
 * measures is the templating package's answer, not this screen's.
 */
export const GSM7_SEGMENT = 160;
export const UCS2_SEGMENT = 70;

/*
 * What a sender may be called, and what has to be registered first.
 */

export type SenderKind = "alphanumeric" | "number" | "registered_header";

export const SENDER_LABELS: Record<SenderKind, string> = {
  alphanumeric: "Alphanumeric",
  number: "Number only",
  registered_header: "Registered header",
};

export const SENDER_NOTES: Record<SenderKind, string> = {
  alphanumeric:
    "A name of up to eleven characters may be used as the sender, with no registration. A reply cannot be sent back to it.",
  number:
    "The sender is a number and cannot be a name. A project's alphanumeric sender ID is ignored here rather than refused, because the carrier drops it.",
  registered_header:
    "The sender is a short header registered with the regulator in advance, and a message from an unregistered one is dropped by the carrier rather than returned.",
};

export type Registration = "none" | "10dlc" | "dlt" | "iys" | "sender_id";

export interface RegistrationInfo {
  id: Registration;
  label: string;
  /** Whether a project must complete it before anything sends to that country. */
  blocking: boolean;
  note: string;
}

export const REGISTRATIONS: Record<Registration, RegistrationInfo> = {
  none: {
    id: "none",
    label: "None",
    blocking: false,
    note: "Nothing to file. Messages send as soon as the country is on the project's allowlist.",
  },
  "10dlc": {
    id: "10dlc",
    label: "10DLC",
    blocking: true,
    note: "US carriers require the brand and the campaign to be registered against the number that sends. Unregistered traffic is filtered rather than rejected, so it looks like delivery and is not.",
  },
  dlt: {
    id: "dlt",
    label: "TRAI DLT",
    blocking: true,
    note: "India registers the sender, the header and the template text itself. A message whose body does not match a registered template is dropped, which makes the template and the route one decision here rather than two.",
  },
  iys: {
    id: "iys",
    label: "IYS",
    blocking: true,
    note: "Turkey requires the sender to be registered and commercial recipients to be checked against the national opt-out list. Transactional one-time codes sit outside the consent rules, the sender registration does not.",
  },
  sender_id: {
    id: "sender_id",
    label: "Sender ID",
    blocking: true,
    note: "The sender name has to be filed with the regulator or the carrier before it will carry traffic. Filing takes days, not minutes.",
  },
};

/*
 * The routing table.
 */

export interface SmsRoute {
  /** ISO 3166-1 alpha-2. Never a dialling prefix: twenty countries share +1. */
  country: string;
  /** Who carries it today. The router may move it on the next request. */
  provider: SmsProviderId;
  /** Who carries it when the first one is failing. Null where there is no second route. */
  failover: SmsProviderId | null;
  /** What the message costs us, per segment, in USD. */
  wholesale: number;
  sender: SenderKind;
  registration: Registration;
}

/**
 * The table as this deployment publishes it. Ordered by country name in the panel and not
 * here, because the order a reader wants is the one they sorted the column into.
 */
export const SMS_ROUTES: readonly SmsRoute[] = [
  {
    country: "US",
    provider: "twilio",
    failover: "aws",
    wholesale: 0.0096,
    sender: "number",
    registration: "10dlc",
  },
  {
    country: "CA",
    provider: "twilio",
    failover: "aws",
    wholesale: 0.0096,
    sender: "number",
    registration: "10dlc",
  },
  {
    country: "GB",
    provider: "aws",
    failover: "twilio",
    wholesale: 0.032,
    sender: "alphanumeric",
    registration: "none",
  },
  {
    country: "DE",
    provider: "aws",
    failover: "twilio",
    wholesale: 0.064,
    sender: "alphanumeric",
    registration: "none",
  },
  {
    country: "FR",
    provider: "aws",
    failover: "twilio",
    wholesale: 0.056,
    sender: "alphanumeric",
    registration: "none",
  },
  {
    country: "NL",
    provider: "twilio",
    failover: "aws",
    wholesale: 0.072,
    sender: "alphanumeric",
    registration: "none",
  },
  {
    country: "ES",
    provider: "aws",
    failover: "twilio",
    wholesale: 0.048,
    sender: "alphanumeric",
    registration: "none",
  },
  {
    country: "IT",
    provider: "aws",
    failover: "twilio",
    wholesale: 0.056,
    sender: "alphanumeric",
    registration: "none",
  },
  {
    country: "TR",
    provider: "regional",
    failover: "twilio",
    wholesale: 0.016,
    sender: "alphanumeric",
    registration: "iys",
  },
  {
    country: "IN",
    provider: "msg91",
    failover: "twilio",
    wholesale: 0.0032,
    sender: "registered_header",
    registration: "dlt",
  },
  {
    country: "AE",
    provider: "twilio",
    failover: null,
    wholesale: 0.024,
    sender: "alphanumeric",
    registration: "sender_id",
  },
  {
    country: "SA",
    provider: "twilio",
    failover: null,
    wholesale: 0.032,
    sender: "alphanumeric",
    registration: "sender_id",
  },
  {
    country: "BR",
    provider: "aws",
    failover: "twilio",
    wholesale: 0.024,
    sender: "number",
    registration: "none",
  },
  {
    country: "MX",
    provider: "aws",
    failover: "twilio",
    wholesale: 0.032,
    sender: "number",
    registration: "none",
  },
  {
    country: "NG",
    provider: "twilio",
    failover: null,
    wholesale: 0.024,
    sender: "alphanumeric",
    registration: "none",
  },
  {
    country: "ID",
    provider: "twilio",
    failover: null,
    wholesale: 0.02,
    sender: "number",
    registration: "none",
  },
  {
    country: "AU",
    provider: "aws",
    failover: "twilio",
    wholesale: 0.032,
    sender: "alphanumeric",
    registration: "none",
  },
  {
    country: "JP",
    provider: "twilio",
    failover: "aws",
    wholesale: 0.048,
    sender: "alphanumeric",
    registration: "none",
  },
];

export function routeFor(country: string): SmsRoute | null {
  const code = country.toUpperCase();
  return SMS_ROUTES.find((route) => route.country === code) ?? null;
}

/**
 * Whether the project may send there at all, which is its allowlist and not the table's
 * business. A country the router can reach and the project has not allowed is a row that
 * has to say so, or an operator reads the table as a list of what their users can do.
 */
export function isAllowed(country: string, allowed: readonly string[]): boolean {
  return allowed.map((code) => code.toUpperCase()).includes(country.toUpperCase());
}

/** The cheapest and dearest rows, for the sentence that says what the table's range is. */
export function priceRange(routes: readonly SmsRoute[]): { low: number; high: number } {
  const prices = routes.map((route) => priceFor(route.wholesale));
  return { low: Math.min(...prices), high: Math.max(...prices) };
}

/*
 * Bringing your own account.
 */

export type SendingMode = "managed" | "byo";

export const MODE_LABELS: Record<SendingMode, string> = {
  managed: "Our routing",
  byo: "Your own account",
};

/** The two vendors a customer may bring, per the price list. Nothing else is offered. */
export type ByoVendor = "twilio" | "vonage";

export interface ByoVendorInfo {
  id: ByoVendor;
  label: string;
  /** What the first credential is called in that vendor's console. */
  keyLabel: string;
  /** And the second, which is written once and never read back. */
  secretLabel: string;
  keyHint: string;
  console: { label: string; href: string };
}

export const BYO_VENDORS: readonly ByoVendorInfo[] = [
  {
    id: "twilio",
    label: "Twilio",
    keyLabel: "Account SID",
    secretLabel: "Auth token",
    keyHint: "Starts with AC and is 34 characters.",
    console: { label: "Twilio console", href: "https://console.twilio.com" },
  },
  {
    id: "vonage",
    label: "Vonage",
    keyLabel: "API key",
    secretLabel: "API secret",
    keyHint: "Eight hexadecimal characters.",
    console: { label: "Vonage dashboard", href: "https://dashboard.nexmo.com" },
  },
];

export function byoVendorInfo(id: ByoVendor): ByoVendorInfo | null {
  return BYO_VENDORS.find((vendor) => vendor.id === id) ?? null;
}

/** What the panel holds about a customer's own account. Never the secret itself. */
export interface ByoAccount {
  vendor: ByoVendor;
  /** The public half, shown so an operator can tell which account is wired. */
  key: string;
  /** The panel is told one is stored and when, and is never told what it is. */
  secretSet: boolean;
  secretUpdatedAt: string | null;
}

export interface ByoDraft {
  vendor: ByoVendor;
  key: string;
  secret: string;
}

export type ByoIssue = "key_invalid" | "secret_missing";

export const BYO_ISSUE_LABELS: Record<ByoIssue, string> = {
  key_invalid: "That is not the shape of that vendor's key.",
  secret_missing: "A vendor with no secret cannot send, so it is not saved without one.",
};

const TWILIO_SID = /^AC[0-9a-f]{32}$/i;
const VONAGE_KEY = /^[0-9a-f]{8}$/i;

/**
 * Whether the key is that vendor's, refused on its shape before anything is stored.
 *
 * The same reasoning as refusing a secret key on its prefix in the CLI: a credential that
 * is wrong in a way we could have seen is one that fails at the vendor instead, on
 * somebody's sign-in, hours later.
 */
export function isByoKey(vendor: ByoVendor, key: string): boolean {
  const value = key.trim();
  return vendor === "twilio" ? TWILIO_SID.test(value) : VONAGE_KEY.test(value);
}

/**
 * The issue with a draft, or null. The secret is required on a first write and optional
 * on a later one, because the panel cannot read the stored one back and a blank field
 * therefore means "leave it" rather than "clear it".
 */
export function validateByo(draft: ByoDraft, hasSecret: boolean): ByoIssue | null {
  if (!isByoKey(draft.vendor, draft.key)) return "key_invalid";
  if (!hasSecret && draft.secret.trim() === "") return "secret_missing";
  return null;
}

/**
 * The mode and the account are one state, because the pair has an invalid combination
 * and keeping them apart is what lets a screen reach it. A project in `byo` with no
 * account sends nothing and says it is sending through a vendor, which is the worst
 * shape a failure can have: confident and wrong.
 */
export interface SendingState {
  mode: SendingMode;
  account: ByoAccount | null;
}

/** Saving credentials is what moves a project onto its own account. */
export function afterAccountSaved(account: ByoAccount): SendingState {
  return { mode: "byo", account };
}

/**
 * Taking the account away puts the project back on our routing in the same change.
 * Sending does not stop: there is always a route, and a project left in `byo` with
 * nothing behind it would refuse every code with no setting on screen to explain it.
 */
export function afterAccountRemoved(): SendingState {
  return { mode: "managed", account: null };
}

/**
 * A mode chosen directly. `byo` is refused where no account is stored, which is what
 * makes the segmented control safe to offer: choosing it opens the dialog instead of
 * moving a project onto a vendor it has no credentials for.
 */
export function withMode(state: SendingState, mode: SendingMode): SendingState {
  if (mode === "byo" && state.account === null) return state;
  return { ...state, mode };
}

/*
 * Whether a country's route can actually carry, and what to do where it cannot.
 *
 * Two of the three answers belong to the project and one belongs to the deployment, so
 * they are not reported together: the allowlist and the registration are what a row can
 * usefully say, and "no adapter is wired" is true of every row at once and is stated
 * above the table instead. A blocker repeated on two hundred rows is not information
 * (notes/sms-providers.md P2).
 */

export type RouteState = "ready" | "not_allowed" | "registration";

export interface RouteReadiness {
  state: RouteState;
  /** The word in the cell. */
  label: string;
  /** One line saying what was found. */
  detail: string;
  /** Where the gap is closed, and never a general guide (notes/sms-providers.md P2). */
  fix: { label: string; to?: string; href?: string } | null;
}

const REGISTRATION_GUIDE = "https://idenzy.dev/docs/sms/registration";

/** What stands between this project and a message to that country. */
export function routeReadiness(route: SmsRoute, allowed: readonly string[]): RouteReadiness {
  if (!isAllowed(route.country, allowed)) {
    return {
      state: "not_allowed",
      label: "Not allowed",
      detail:
        "The country is not on this project's allowlist, so a send there is refused before it costs anything.",
      fix: { label: "Allow it", to: "/sms/policy" },
    };
  }
  const registration = REGISTRATIONS[route.registration];
  if (registration.blocking) {
    return {
      state: "registration",
      label: `Needs ${registration.label}`,
      detail: registration.note,
      fix: { label: `${registration.label} guide`, href: REGISTRATION_GUIDE },
    };
  }
  return {
    state: "ready",
    label: "Ready",
    detail: "Allowed, and nothing has to be filed before a message goes there.",
    fix: null,
  };
}

/** How the destinations table is narrowed. Allowed first is the default the note asks for. */
export type DestinationFilter = "allowed_first" | "allowed_only" | "all";

export const DESTINATION_FILTERS: readonly { value: DestinationFilter; label: string }[] = [
  { value: "allowed_first", label: "Allowed first" },
  { value: "allowed_only", label: "Allowed only" },
  { value: "all", label: "All countries" },
];

/**
 * Where the figures in the price column come from, said once rather than implied.
 *
 * They are the published regional wholesale plus our margin, held in this file. Nothing
 * reads a live rate card yet, so a price here is an example of what a country costs and
 * not a quote (notes/sms-providers.md P1).
 */
export const RATE_SOURCE =
  "Rates are the published regional wholesale plus our margin, held in the panel rather than read from a live price feed. Treat them as examples of what a country costs, not as a quote.";
