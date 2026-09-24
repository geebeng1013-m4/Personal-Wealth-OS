import assert from "node:assert/strict";
import { test } from "./testHarness";
import { MAX_LINKS, parseAnswerLinks } from "../src/components/assistant/assistantLinks";
import { ALL_PAGES } from "../src/pageDirectory";
import { SYSTEM_PROMPT } from "../functions/src/deepseekRequest";

test("links: a marker becomes a button and never reaches the screen", () => {
  const { text, links } = parseAnswerLinks("Record it on the Ledger page.\n\n[[go:ledger]]");
  assert.equal(text, "Record it on the Ledger page.");
  assert.deepEqual(links, [{ page: "ledger", label: "Ledger" }]);
});

test("links: a page the app does not have produces NO button, and still disappears", () => {
  // The whole reason the marker is an id checked against the app: a model that
  // misremembers cannot send anyone to a page that is not there.
  const { text, links } = parseAnswerLinks("Try the Taxes page.\n\n[[go:taxes]]");
  assert.deepEqual(links, []);
  assert.equal(text, "Try the Taxes page.");
  assert.doesNotMatch(text, /\[\[/, "the marker is stripped whether or not it was usable");
});

test("links: every page in the app can be linked to", () => {
  for (const [id, name] of ALL_PAGES) {
    const { links } = parseAnswerLinks(`Go there. [[go:${id}]]`);
    assert.deepEqual(links, [{ page: id, label: name }], id);
  }
});

test("links: case and stray spaces in the marker are forgiven", () => {
  assert.deepEqual(parseAnswerLinks("x [[GO: Ledger ]]").links, [{ page: "ledger", label: "Ledger" }]);
  assert.deepEqual(parseAnswerLinks("x [[ go:money-leaks ]]").links, [{ page: "money-leaks", label: "Money Leaks" }]);
});

test("links: the same page twice is one button", () => {
  const { links } = parseAnswerLinks("[[go:ledger]] and again [[go:ledger]]");
  assert.equal(links.length, 1);
});

test("links: more than two are trimmed, in the order they were written", () => {
  const { links } = parseAnswerLinks("[[go:ledger]][[go:goals]][[go:settings]][[go:review]]");
  assert.equal(links.length, MAX_LINKS);
  assert.deepEqual(links.map((link) => link.page), ["ledger", "goals"]);
});

test("links: an answer with no marker is left exactly as it was", () => {
  const answer = "Your emergency fund comes first.\nNothing to open here.";
  const { text, links } = parseAnswerLinks(answer);
  assert.equal(text, answer);
  assert.deepEqual(links, []);
});

test("links: removing a marker does not leave a hole in the text", () => {
  const { text } = parseAnswerLinks("First line.\n\n[[go:ledger]]\n\nSecond line.");
  assert.equal(text, "First line.\n\nSecond line.", "no run of blank lines where the marker was");
});

test("links: prose that merely mentions a page grows no button", () => {
  // Scanning the prose for page names was the alternative, and this sentence is
  // why it was not taken: it names two pages and means neither as a destination.
  const { links } = parseAnswerLinks("Broad market-cap ETFs are the Overview of a simple plan.");
  assert.deepEqual(links, []);
});

test("links: the prompt explains the marker, its limit, and when not to use it", () => {
  assert.match(SYSTEM_PROMPT, /\[\[go:PAGE-ID\]\]/);
  assert.match(SYSTEM_PROMPT, /At most two/);
  assert.match(SYSTEM_PROMPT, /NONE for a page they are already on/);
  assert.match(SYSTEM_PROMPT, /never mention the marker itself/);
});

test("links: every id the prompt offers is a real page id", () => {
  // The prompt lists the ids by hand, because the model needs them spelled out.
  // This is the test that keeps that list honest.
  const line = /The ids are ([^.]+)\./.exec(SYSTEM_PROMPT.replace(/",\s*"\s*/g, " "))?.[1] ?? "";
  const ids = [...line.matchAll(/\b([a-z]+(?:-[a-z]+)?)\b(?=,|$| \()/g)].map((match) => match[1]);
  const known = new Set(ALL_PAGES.map(([id]) => id));
  const offered = ids.filter((id) => known.has(id));
  assert.equal(offered.length, ALL_PAGES.length, `prompt offers ${offered.length} of ${ALL_PAGES.length} page ids`);
  for (const id of ids) {
    if (["this", "is", "budget", "investment", "growth"].includes(id)) continue;
    assert.ok(known.has(id), `the prompt offers "${id}", which is not a page id`);
  }
});
