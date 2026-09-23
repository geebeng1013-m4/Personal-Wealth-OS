import assert from "node:assert/strict";
import { test } from "./testHarness";
import { ALL_PAGES, PAGE_GROUPS, PHONE_TABS, describePage, pageName } from "../src/pageDirectory";
import { SYSTEM_PROMPT } from "../functions/src/deepseekRequest";
import { buildAssistantContext } from "../src/components/assistant/assistantContext";
import { emptyState } from "../src/state";

/**
 * The assistant tells people which page to go to. If the app grows a page,
 * renames one or drops one, the prompt has to move with it — otherwise the
 * assistant sends somebody to a page that is not there, in a confident voice.
 *
 * These tests are the seam: the app's navigation on one side, the prompt's page
 * list on the other. They are meant to FAIL when only one side changes.
 */

/**
 * The prompt's page section, which is where every page name must appear.
 *
 * It ends where the how-to guide begins. The guide has bullet lines of its own
 * in the same "- X — y" shape, and swallowing them would make this test insist
 * every task heading is a page.
 */
function pageSection(): string {
  const start = SYSTEM_PROMPT.indexOf("THE PAGES");
  const end = SYSTEM_PROMPT.indexOf("HOW THINGS ARE DONE");
  assert.ok(start >= 0, "the prompt has a page section");
  assert.ok(end > start, "and the how-to guide follows it");
  return SYSTEM_PROMPT.slice(start, end);
}

test("page map: every page in the app appears in the prompt, with its own subtitle", () => {
  const section = pageSection();
  for (const [id, name, subtitle] of ALL_PAGES) {
    assert.ok(section.includes(`- ${name} — ${subtitle}`), `${id} (${name}) is missing from the prompt's page list`);
  }
});

test("page map: every group heading appears too, so the list reads like the sidebar", () => {
  const section = pageSection();
  for (const [title] of PAGE_GROUPS) {
    assert.ok(section.includes(`\n${title}\n`), `group "${title}" is missing from the prompt`);
  }
});

test("page map: the prompt names no page the app does not have", () => {
  // Every "- Name — subtitle" line in the section must be a real page. This is
  // the half that catches a page the app dropped but the prompt kept.
  const names = new Set(ALL_PAGES.map(([, name]) => name));
  const listed = [...pageSection().matchAll(/^- (.+?) — /gm)].map((match) => match[1]);
  assert.ok(listed.length > 0, "the section actually lists pages");
  for (const name of listed) {
    assert.ok(names.has(name), `the prompt lists "${name}", which is not a page in this app`);
  }
  assert.equal(listed.length, ALL_PAGES.length, "the prompt lists every page exactly once");
});

test("page map: the phone's four tabs are described, including Overview being called Home", () => {
  const section = pageSection();
  for (const [id, label] of PHONE_TABS) {
    assert.ok(section.includes(label), `phone tab "${label}" (${id}) is not mentioned`);
  }
  // The one place the two navigations disagree, and the one most likely to
  // send a phone user hunting for a sidebar entry that is not there.
  assert.match(section, /Home \(this is Overview\)/);
  assert.match(section, /More/, "the fifth button that opens everything else");
});

test("page map: Money Leaks and Me are there — the two the old handwritten list forgot", () => {
  const section = pageSection();
  assert.ok(section.includes("Money Leaks"));
  assert.ok(section.includes("- Me — "));
});

// --- the directory itself -------------------------------------------------

test("page map: ids are unique, and every phone tab is a real page", () => {
  const ids = ALL_PAGES.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length, "no page id is repeated");
  for (const [id] of PHONE_TABS) {
    assert.ok(ids.includes(id), `phone tab ${id} is a real page`);
  }
});

test("page map: a page is described for the assistant as name plus subtitle", () => {
  assert.equal(describePage("ledger"), "Ledger (Income & expenses)");
  assert.equal(pageName("money-leaks"), "Money Leaks");
  // An id the app does not know is passed through rather than invented over.
  assert.equal(describePage("nowhere"), "nowhere");
  assert.equal(pageName("nowhere"), "nowhere");
});

// --- telling the assistant where the user is ------------------------------

test("page map: Ask mode says which page the user is on, in words the model knows", () => {
  const context = buildAssistantContext(emptyState(), new Date(2026, 8, 24), {
    mode: "help",
    shareFigures: false,
    platforms: [],
    page: "money-leaks",
  });
  assert.match(context, /The user is on the Money Leaks \(Detected cash-flow drag\) page\./);
  // Still no figures: knowing which page someone is looking at is not knowing
  // anything about their money.
  assert.doesNotMatch(context, /MYR/);
});

test("page map: with no page given, nothing is claimed about where they are", () => {
  const context = buildAssistantContext(emptyState(), new Date(2026, 8, 24), {
    mode: "help",
    shareFigures: false,
    platforms: [],
  });
  assert.doesNotMatch(context, /is on the/);
});

test("page map: Record mode carries vocabulary, not the page", () => {
  // Filling a form needs names; which page they are on does not help, and
  // Record's context is the one that stays free of anything it does not need.
  const context = buildAssistantContext(emptyState(), new Date(2026, 8, 24), {
    mode: "fill",
    shareFigures: false,
    platforms: [],
    page: "ledger",
  });
  assert.doesNotMatch(context, /is on the/);
});

test("page map: the prompt tells the model what to do with the current page", () => {
  assert.match(SYSTEM_PROMPT, /which page the user is on/);
  assert.match(SYSTEM_PROMPT, /you are on it/);
});
