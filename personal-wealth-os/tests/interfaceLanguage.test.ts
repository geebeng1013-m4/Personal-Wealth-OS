import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getLanguage, setLanguage } from "../src/i18n";
import { localizeInterface, nativeValidationMessage } from "../src/interfaceLanguage";

/** Small text-node fixtures exercise the display boundary without browser globals. */
function withTextNode(check: () => void): void {
  const before = getLanguage();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Node");
  Object.defineProperty(globalThis, "Node", { configurable: true, value: { TEXT_NODE: 3 } });
  setLanguage("zh-CN");
  try { check(); } finally {
    setLanguage(before);
    if (descriptor) Object.defineProperty(globalThis, "Node", descriptor);
    else Reflect.deleteProperty(globalThis, "Node");
  }
}

test("interface language: translated options retain their submitted English values", () => withTextNode(() => {
  let value: string | null = null;
  const node = {
    nodeType: 3,
    data: "Manual Buy",
    parentElement: { closest: (selector: string): unknown => selector === "option" ? option : null },
  };
  const option = {
    get value() { return value ?? node.data; },
    hasAttribute: () => value !== null,
    setAttribute: (_name: string, next: string) => { value = next; },
  };
  localizeInterface(node as unknown as Node, []);
  assert.equal(node.data, "手动买入");
  assert.equal(option.value, "Manual Buy");
  localizeInterface(node as unknown as Node, []);
  assert.equal(option.value, "Manual Buy", "a later mutation pass cannot pin the translated name");
  setLanguage("en");
  localizeInterface(node as unknown as Node, []);
  assert.equal(node.data, "Manual Buy");
}));

test("interface language: async replacements translate, and English restores the latest source", () => withTextNode(() => {
  const node = { nodeType: 3, data: "Income", parentElement: { closest: () => null } };
  localizeInterface(node as unknown as Node, []);
  assert.equal(node.data, "收入");
  node.data = "Market value";
  localizeInterface(node as unknown as Node, []);
  assert.equal(node.data, "市值");
  setLanguage("en");
  localizeInterface(node as unknown as Node, []);
  assert.equal(node.data, "Market value");
}));

test("interface language: protected user copy and amount nodes remain literal", () => withTextNode(() => {
  const user = { nodeType: 3, data: "Save", parentElement: { closest: () => null } };
  localizeInterface(user as unknown as Node, ["Save"]);
  assert.equal(user.data, "Save");
  const amount = { nodeType: 3, data: "MYR 1,234.56", parentElement: { closest: () => ({}) } };
  localizeInterface(amount as unknown as Node, []);
  assert.equal(amount.data, "MYR 1,234.56");
}));

test("interface language: a Save button still translates when a user named an account Save", () => withTextNode(() => {
  const node = { nodeType: 3, data: "Save", parentElement: { closest: (selector: string) => selector.includes(".wu-btn") ? {} : null } };
  localizeInterface(node as unknown as Node, ["Save"]);
  assert.equal(node.data, "保存");
}));

test("interface language: browser validation messages include numeric bounds in Chinese", () => {
  const valid: ValidityState = { valid: false, customError: false, valueMissing: false, typeMismatch: false, badInput: false, rangeUnderflow: false, rangeOverflow: false, stepMismatch: false, tooShort: false, tooLong: false, patternMismatch: false };
  assert.equal(nativeValidationMessage({ ...valid, valueMissing: true }, "", ""), "请填写此项。");
  assert.equal(nativeValidationMessage({ ...valid, rangeUnderflow: true }, "0.01", "100.50"), "请输入不小于 0.01 的数值。");
  assert.equal(nativeValidationMessage({ ...valid, rangeOverflow: true }, "0.01", "100.50"), "请输入不大于 100.50 的数值。");
  assert.equal(nativeValidationMessage({ ...valid, badInput: true }, "", ""), "请输入有效数字。");
});
