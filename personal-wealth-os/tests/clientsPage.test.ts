import assert from "node:assert/strict";
import { test } from "./testHarness";
import { clientsTemplate } from "../src/pages/clientsPage";

test("advisor preview: five clients, most urgent first, figures agree with the rows", () => {
  const html = clientsTemplate();
  const names = [...html.matchAll(/<\/span> ([^<]+)<small>/g)].map((match) => match[1]);
  assert.deepEqual(names, ["Jason Tan", "Nurul Aisyah", "Ho Mei Ling", "Daniel Lim", "Kumar Raj"]);
  assert.equal((html.match(/wu-client--call/g) ?? []).length, 2);
  assert.match(html, /id="clientsCallLabel">Need a call<\/span><\/div>\s*<p class="wu-money wu-money--md"><span>2<\/span>/);
  assert.match(html, /<span>2<\/span><span class="wu-money__of">of 5<\/span>/, "on plan");
});

test("advisor preview: it says it is a preview, and every status has a word, not only a colour", () => {
  const html = clientsTemplate();
  assert.match(html, /Preview of the advisor view/);
  assert.equal((html.match(/class="visually-hidden">(Needs a call|Watch|On plan): /g) ?? []).length, 5);
});

test("advisor preview: clients can only propose changes, and the names read as a planner would say them", () => {
  const html = clientsTemplate();
  assert.match(html, /Clients cannot change the plan you set/);
  assert.equal((html.match(/class="wu-proposal"/g) ?? []).length, 2);
  assert.match(html, /id="clientsChangesLabel">Changes to review<\/span><\/div>\s*<p class="wu-money wu-money--md"><span>2<\/span><\/p>\s*<p class="wu-dash__note">Nurul, Mei Ling<\/p>/);
});
