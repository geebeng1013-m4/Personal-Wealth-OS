/**
 * "Take me there" — turning an answer's page marker into a button.
 *
 * An Ask answer that says "go to the Ledger page" leaves the person to find it
 * themselves. The model can end such an answer with a marker, `[[go:ledger]]`,
 * and the panel renders a button that navigates there. The marker never reaches
 * the screen.
 *
 * The marker is a page ID, checked against the app's own page list here. A page
 * that does not exist produces NO button — the marker is simply dropped with
 * the rest. That is the whole reason for a marker instead of scanning the prose
 * for page names: "broad market-cap ETFs" would otherwise grow an "Open Market"
 * button, and a model that misremembers a page cannot invent a destination.
 *
 * Pure: no DOM, no navigation. The widget does both.
 */

import { ALL_PAGES, pageName } from "../../pageDirectory";

/** `[[go:ledger]]`, anywhere in the reply, however much space is around it. */
const MARKER = /\[\[\s*go\s*:\s*([a-z0-9-]+)\s*\]\]/gi;

/**
 * Two is already a lot to offer at the end of an answer; a third is the model
 * listing the app rather than answering. Extra markers are dropped, not shown.
 */
export const MAX_LINKS = 2;

export interface AnswerLink {
  /** The page id to navigate to. Always one the app has. */
  page: string;
  /** What the button says, in the words the navigation uses. */
  label: string;
}

export interface ParsedAnswer {
  /** The answer with every marker removed, ready to be shown. */
  text: string;
  /** The buttons to offer under it, in the order they were mentioned. */
  links: AnswerLink[];
}

const isPage = (id: string): boolean => ALL_PAGES.some(([pageId]) => pageId === id);

/**
 * Split an answer into what to show and where it offers to go.
 *
 * Markers are matched case-insensitively and the id is lower-cased, since a
 * model that writes `[[GO:Ledger]]` meant the same thing. Duplicates collapse.
 */
export function parseAnswerLinks(reply: string): ParsedAnswer {
  const links: AnswerLink[] = [];
  const seen = new Set<string>();

  for (const match of reply.matchAll(MARKER)) {
    const page = match[1].toLowerCase();
    if (!isPage(page) || seen.has(page) || links.length >= MAX_LINKS) continue;
    seen.add(page);
    links.push({ page, label: pageName(page) });
  }

  // Strip every marker, including the ones that produced no button, and tidy
  // the hole left behind: a marker on its own line should not leave a blank one.
  const text = reply
    .replace(MARKER, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, links };
}
