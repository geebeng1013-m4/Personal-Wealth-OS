import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "./testHarness";
import { SYSTEM_PROMPT } from "../functions/src/deepseekRequest";

/*
 * docs/assistant-principles.md is the agreed version of the principles; the
 * system prompt is what the model actually reads. These checks catch one being
 * edited without the other. They compare titles and the numbers people argue
 * about, not wording — the doc is Chinese prose, the prompt English.
 */

const doc = readFileSync(resolve(process.cwd(), "docs/assistant-principles.md"), "utf8").replace(/\*\*/g, "");
const prompt = SYSTEM_PROMPT.replace(/\s+/g, " ");

test("principles doc: the six principle titles match the prompt, in order", () => {
  const promptTitles = [...SYSTEM_PROMPT.matchAll(/^(\d)\. ([A-Za-z ]+)\./gm)].map((m) => `${m[1]}. ${m[2]}`);
  const docTitles = [...doc.matchAll(/^### (\d\. [A-Za-z ]+)（/gm)].map((m) => m[1]);
  assert.equal(promptTitles.length, 6, `prompt titles: ${promptTitles.join(" | ")}`);
  assert.deepEqual(docTitles, promptTitles);
});

test("principles doc: the key figures agree with the prompt", () => {
  const pairs: Array<[inPrompt: string, inDoc: string]> = [
    ["50% needs, 30% wants", "50% 需要 / 30% 想要 / 20% 储蓄"],
    ["3 to 6 months of ESSENTIAL expenses", "3 到 6 个月的必要支出"],
    ["6 months by default", "默认 6 个月"],
    ["About 8% a year", "年化约 8%"],
    ["drift is above 8%", "偏差超过 8%"],
    ["a goal 3 years away or less goes in a money market fund", "3 年或以内 → 货币市场基金"],
    ["Do not recommend keeping a bear-market reserve, but do not rule it out either", "不主动推荐，但也不再一概否定"],
  ];
  for (const [inPrompt, inDoc] of pairs) {
    assert.ok(prompt.includes(inPrompt), `prompt no longer says: ${inPrompt}`);
    assert.ok(doc.includes(inDoc), `doc no longer says: ${inDoc}`);
  }
});

test("principles doc: both eval question counts match the script", () => {
  const script = readFileSync(resolve(process.cwd(), "scripts/assistant-principles-eval.mjs"), "utf8");
  // The two sets are counted apart: one proves the principles hold, the other
  // proves the app is described as it is. A question added to either has to
  // show up in the doc's own table, or the doc stops being the record.
  const [principles, howto] = script.split("const HOWTO_CASES");
  assert.ok(howto, "the script still has a how-to set");
  const count = (text: string): number => [...text.matchAll(/\{ id: "[A-Z]+-\d+"/g)].length;
  assert.ok(doc.includes(`共 ${count(principles)} 题`), `principles set has ${count(principles)} questions`);
  assert.ok(doc.includes(`共 ${count(howto)} 题`), `how-to set has ${count(howto)} questions`);
});
