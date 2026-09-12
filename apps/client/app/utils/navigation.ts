/**
 * Where the panel can go, in the order the drawer shows it.
 *
 * One tree rather than a list per screen, because the drawer, the rail's flyouts and
 * the "which group holds this route" question all read the same structure and would
 * otherwise disagree about it. Sections carry a heading; a group folds its children
 * under one glyph; a link is a screen. The screens are the dashboard PROJECT.md 3.2
 * describes, and most of them are routes that do not exist yet.
 *
 * Icon names are written out in full. `@nuxt/icon` bundles what it finds by scanning
 * `app/**\/*.ts`, so a literal here is compiled in and a name assembled at runtime would
 * draw nothing and report nothing.
 */
export interface NavLink {
  title: string;
  to: string;
  /** Top-level links carry one; a link inside a group is indented instead. */
  icon?: string;
}

export interface NavGroup {
  /** What `v-list` tracks the open state by. Stable, because it is written to storage. */
  id: string;
  title: string;
  icon: string;
  children: readonly NavLink[];
}

export type NavEntry = NavLink | NavGroup;

export interface NavSection {
  /** Absent on the first section, which is the one above every heading. */
  heading?: string;
  entries: readonly NavEntry[];
}

export function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    entries: [
      { title: "Overview", to: "/", icon: "material-symbols:space-dashboard-outline" },
      {
        id: "users",
        title: "Users",
        icon: "material-symbols:group-outline",
        children: [
          { title: "All users", to: "/users" },
          { title: "Sessions & devices", to: "/sessions" },
          { title: "Import", to: "/import" },
        ],
      },
    ],
  },
  {
    heading: "Authenticate",
    entries: [
      {
        id: "methods",
        title: "Sign-in methods",
        icon: "material-symbols:key-outline",
        children: [
          { title: "Passwords", to: "/methods/passwords" },
          { title: "Passkeys", to: "/methods/passkeys" },
          { title: "One-time codes", to: "/methods/otp" },
          { title: "Social providers", to: "/methods/providers" },
        ],
      },
      {
        id: "mfa",
        title: "Multi-factor",
        icon: "material-symbols:shield-lock-outline",
        children: [
          { title: "Authenticator apps", to: "/mfa/totp" },
          { title: "Recovery codes", to: "/mfa/recovery" },
          { title: "Additional verification", to: "/mfa/step-up" },
        ],
      },
      {
        id: "tokens",
        title: "Tokens",
        icon: "material-symbols:token-outline",
        children: [
          { title: "Claim templates", to: "/tokens/claims" },
          { title: "Lifetimes", to: "/tokens/lifetimes" },
          { title: "Revocation", to: "/tokens/revocation" },
        ],
      },
    ],
  },
  {
    heading: "Deliver",
    entries: [
      {
        id: "email",
        title: "Email",
        icon: "material-symbols:mail-outline",
        children: [
          { title: "Templates", to: "/email/templates" },
          { title: "Blocked addresses", to: "/email/suppressions" },
          { title: "Sending domains", to: "/email/domains" },
        ],
      },
      {
        id: "sms",
        title: "SMS",
        icon: "material-symbols:sms-outline",
        children: [
          { title: "Policy & spend", to: "/sms/policy" },
          { title: "Providers", to: "/sms/providers" },
        ],
      },
      {
        id: "domains",
        title: "Domains",
        icon: "material-symbols:language",
        children: [
          { title: "Auth domains", to: "/domains" },
          { title: "Allowed origins", to: "/domains/origins" },
        ],
      },
    ],
  },
  {
    heading: "Observe",
    entries: [
      { title: "Audit log", to: "/audit", icon: "material-symbols:history" },
      { title: "Security center", to: "/security", icon: "material-symbols:security" },
      { title: "Usage", to: "/usage", icon: "material-symbols:monitoring" },
    ],
  },
  {
    heading: "Integrate",
    entries: [
      { title: "API keys", to: "/keys", icon: "material-symbols:vpn-key-outline" },
      { title: "Webhooks", to: "/webhooks", icon: "material-symbols:webhook" },
      { title: "Hooks", to: "/hooks", icon: "material-symbols:alt-route" },
      {
        title: "Data requests",
        to: "/data-requests",
        icon: "material-symbols:folder-managed-outline",
      },
    ],
  },
];

/**
 * Below the rule at the foot of the list: the things that are about the account rather
 * than about what it does.
 *
 * Settings is one drawer item and three tabs, not three drawer items. The rail inside the
 * page is what navigates between them, so listing the children here as well would offer
 * the same three destinations twice, a click apart. The group still exists because the
 * breadcrumb and the browser tab read it, and a route the tree cannot name shows as
 * "Idenzy" with no crumb at all.
 */
export const NAV_SETTINGS: NavGroup = {
  id: "settings",
  title: "Settings",
  icon: "material-symbols:settings-outline",
  children: [
    { title: "General", to: "/settings" },
    { title: "Members", to: "/settings/members" },
    { title: "Account", to: "/settings/account" },
  ],
};

/**
 * Money, on its own.
 *
 * The wallet is the organisation's rather than one project's, and understanding a bill is
 * its own task rather than a setting somebody changes, so it sits beside Settings instead
 * of inside it. Filed under Project settings it would also have said the wrong thing about
 * its own scope, which is the first finding on all three settings notes.
 *
 * Like Settings, one drawer item and four tabs: the rail inside the page moves between
 * them, and the group exists so the breadcrumb can say "Billing / Invoices" and a link to
 * one tab lands on it.
 */
export const NAV_BILLING: NavGroup = {
  id: "billing",
  title: "Billing",
  icon: "material-symbols:receipt-long-outline",
  children: [
    { title: "Overview", to: "/billing" },
    { title: "Wallet", to: "/billing/wallet" },
    { title: "Payment methods", to: "/billing/methods" },
    { title: "Invoices", to: "/billing/invoices" },
  ],
};

/** The groups, in order, so the drawer can find the one a route lives in. */
export const NAV_GROUPS: readonly NavGroup[] = [
  ...NAV_SECTIONS.flatMap((section) => section.entries.filter(isGroup)),
  NAV_SETTINGS,
  NAV_BILLING,
];

/** The group whose child is `path`, or null for a top-level screen. */
export function groupOf(path: string): NavGroup | null {
  return NAV_GROUPS.find((group) => group.children.some((child) => child.to === path)) ?? null;
}

/** Every screen in the tree, flat, so a path can be named. */
export const NAV_LINKS: readonly NavLink[] = [
  ...NAV_SECTIONS.flatMap((section) =>
    section.entries.flatMap((entry) => (isGroup(entry) ? entry.children : [entry])),
  ),
  ...NAV_SETTINGS.children,
  ...NAV_BILLING.children,
];

/**
 * The screen at `path`. A path the tree does not name exactly resolves to the deepest
 * link it sits under, so one user's page reads as "All users" rather than as nothing.
 * The root is excluded from that, or it would name every path there is.
 */
export function linkOf(path: string): NavLink | null {
  const exact = NAV_LINKS.find((link) => link.to === path);
  if (exact) return exact;
  const above = NAV_LINKS.filter((link) => link.to !== "/" && path.startsWith(`${link.to}/`));
  above.sort((a, b) => b.to.length - a.to.length);
  return above[0] ?? null;
}

/** What the tab calls the screen at `path`. */
export function titleOf(path: string): string | null {
  return linkOf(path)?.title ?? null;
}

export interface Crumb {
  title: string;
  /** Absent on a group, which is a place in the tree and not a screen. */
  to?: string;
}

/** The way down the tree to the screen at `path`: its group, when it has one, then itself. */
export function crumbsOf(path: string): Crumb[] {
  const link = linkOf(path);
  if (!link) return [];
  const group = NAV_GROUPS.find((candidate) => candidate.children.includes(link));
  const last: Crumb = { title: link.title, to: link.to };
  return group ? [{ title: group.title }, last] : [last];
}
