/**
 * What pages WealthUp has, and what the navigation calls them.
 *
 * This is the one definition. `ui.ts` renders the sidebar and the phone tab bar
 * from it, and the assistant's system prompt describes the same pages to the
 * model — with `tests/assistantPageMap.test.ts` comparing the two, so a page
 * added, renamed or removed here cannot quietly leave the assistant pointing
 * somebody at a page that is not there any more.
 *
 * That is the whole reason this lives on its own instead of inside ui.ts: a
 * test can import this file, while importing ui.ts would drag in Firebase, the
 * DOM and every page module with it.
 *
 * Nothing here imports anything. Keep it that way.
 */

export type Page = readonly [id: string, english: string, subtitle: string];
export type PageGroup = readonly [title: string, pages: readonly Page[]];

/** The sidebar, in the order it is shown. */
export const PAGE_GROUPS = [
  ["Wealth", [
    ["dashboard", "Overview", "Financial command centre"],
    ["portfolio", "Portfolio", "Investments & activity"],
    ["goals", "Goals", "Progress & targets"],
    ["market", "Market", "Research when needed"],
  ]],
  ["Money", [
    ["ledger", "Ledger", "Income & expenses"],
    ["buckets", "Budget", "Fund allocation"],
    ["money-leaks", "Money Leaks", "Detected cash-flow drag"],
  ]],
  ["Intelligence", [
    ["advisor", "Advisor", "Guidance & scenarios"],
    ["review", "Review", "Monthly check-in"],
    ["rules", "Rules", "Decision framework"],
  ]],
  ["Tools", [
    ["tvm", "TVM Calculator", "Time value of money"],
    ["calculator", "Investment Growth", "Contribution projections"],
  ]],
  ["System", [
    ["me", "Me", "About you"],
    ["settings", "Settings", "Configuration"],
  ]],
] as const satisfies readonly PageGroup[];

/** Every page, flattened, still in sidebar order. */
export const ALL_PAGES: readonly Page[] = PAGE_GROUPS.flatMap<Page>(([, pages]) => [...pages]);

/**
 * The four pages with a permanent tab at the bottom of a phone screen. Everything
 * else is reached through the fifth button, "More". The label differs from the
 * sidebar's in one place — Overview is "Home" down there — which is exactly the
 * kind of detail the assistant would otherwise get wrong.
 */
export const PHONE_TABS: ReadonlyArray<readonly [id: string, label: string]> = [
  ["dashboard", "Home"],
  ["ledger", "Ledger"],
  ["portfolio", "Portfolio"],
  ["buckets", "Budget"],
];

/** The sidebar name of a page id, or the id itself if it is not a page. */
export function pageName(id: string): string {
  return ALL_PAGES.find(([pageId]) => pageId === id)?.[1] ?? id;
}

/** "Ledger (Income & expenses)" — how the assistant is told where the user is. */
export function describePage(id: string): string {
  const page = ALL_PAGES.find(([pageId]) => pageId === id);
  return page ? `${page[1]} (${page[2]})` : id;
}
