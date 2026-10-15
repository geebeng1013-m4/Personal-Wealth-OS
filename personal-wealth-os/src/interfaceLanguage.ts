import type { WealthState } from "./models";
import { getLanguage, setProtectedValuesProvider, t, translateUiText } from "./i18n";
import { defaultState } from "./state";
import { DEBT_KINDS, isDebtKind } from "./debtPriority";

const messageContent = ".assistant-msg:not(.assistant-msg--error) .assistant-msg__bubble";
const literalContent = `script,style,textarea,input,[contenteditable],[data-i18n-user],.t-amt,.wu-me-card__email,.wu-me-card__initials,${messageContent}`;
const translatedAttributes = ["placeholder", "aria-label", "title"] as const;
const textCopies = new WeakMap<Text, { original: string; displayed: string }>();
const attributeCopies = new WeakMap<Element, Map<string, { original: string; displayed: string }>>();

/** User-owned values are never dictionary keys, even if someone named an account 'Budget'. */
export function userDisplayValues(state: WealthState): string[] {
  const strings = new Set<string>();
  const keys = new Set(["name", "label", "note", "notes", "title", "body", "content", "ticker", "platform", "financialGoal", "goalName"]);
  const visit = (value: unknown, seed: unknown, key = ""): void => {
    if (typeof value === "string") {
      // Unchanged seeded copy belongs to the interface. Compare by record ID,
      // rather than by text alone: a custom account named "Growth" is still
      // user content, even though a default allocation has that name too.
      if (keys.has(key) && value.trim() && value !== seed) {
        strings.add(value);
        if (["note", "notes", "body", "content"].includes(key)) value.split(/[\n|]/).forEach((line) => { if (line.trim()) strings.add(line.trim()); });
      }
    } else if (Array.isArray(value)) value.forEach((item) => {
      const id = item && typeof item === "object" && "id" in item ? item.id : undefined;
      const original = id !== undefined && Array.isArray(seed)
        ? seed.find((entry: unknown) => entry && typeof entry === "object" && "id" in entry && entry.id === id)
        : undefined;
      visit(item, original, key);
    });
    else if (value && typeof value === "object") Object.entries(value).forEach(([name, item]) => {
      // These labels are generated from actions or category choices, rather
      // than typed by the user. Custom category names are protected separately.
      if (name === "actionRecords" || name === "checkins") return;
      const debtKind = "kind" in value ? value.kind : "debtKind" in value ? value.debtKind : undefined;
      if ((name === "name" || name === "goalName") && isDebtKind(debtKind) && item === DEBT_KINDS[debtKind].label) return;
      const original = seed && typeof seed === "object" && !Array.isArray(seed)
        ? (seed as Record<string, unknown>)[name] : undefined;
      visit(item, original, name);
    });
  };
  visit(state, defaultState);
  return [...strings].sort((a, b) => b.length - a.length);
}

/** Text-node writes preserve markup, event handlers, form values and financial records. */
export function localizeInterface(root: Node, protectedValues: readonly string[]): void {
  const language = getLanguage();
  const translateText = (node: Text): void => {
    if (node.parentElement?.closest(literalContent)) return;
    // HTML options without a value inherit it from their visible text. Pin
    // the original value before translating, including options added later.
    const option = node.parentElement?.closest("option");
    if (option && !option.hasAttribute("value")) option.setAttribute("value", option.value);
    const current = node.data;
    const previous = textCopies.get(node);
    const original = previous?.displayed === current ? previous.original : current;
    const isControlCopy = node.parentElement?.closest(".wu-page-header,.wu-label,.wu-field-row__label,.wu-btn:not([data-ledger-tag]),.nav-item,.tabbar,.wu-set__title,.more-group__title,.assistant-tab");
    const copy = isControlCopy ? protectedValues.filter((value) => value.trim() !== original.trim()) : protectedValues;
    const displayed = translateUiText(original, language, copy);
    textCopies.set(node, { original, displayed });
    if (current !== displayed) node.data = displayed;
  };
  const translateAttributes = (element: Element): void => {
    if (element.closest(`script,style,[data-i18n-user],${messageContent}`)) return;
    const copies = attributeCopies.get(element) ?? new Map();
    for (const attr of translatedAttributes) {
      const current = element.getAttribute(attr);
      if (current === null) continue;
      const previous = copies.get(attr);
      const original = previous?.displayed === current ? previous.original : current;
      const displayed = translateUiText(original, language, protectedValues);
      copies.set(attr, { original, displayed });
      if (current !== displayed) element.setAttribute(attr, displayed);
    }
    attributeCopies.set(element, copies);
  };
  if (root.nodeType === Node.TEXT_NODE) { translateText(root as Text); return; }
  if (root instanceof Element) translateAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (walker.currentNode.nodeType === Node.TEXT_NODE) translateText(walker.currentNode as Text);
    else translateAttributes(walker.currentNode as Element);
  }
}

let activeState: (() => WealthState) | null = null;
let cachedState: WealthState | null = null;
let protectedValues: string[] = [];

function protectedCopy(): string[] {
  const state = activeState?.();
  if (state && state !== cachedState) {
    cachedState = state;
    protectedValues = userDisplayValues(state);
  }
  return protectedValues;
}

export function uiConfirm(message: string): boolean {
  return window.confirm(translateUiText(message, getLanguage(), protectedCopy()));
}

export function uiAlert(message: string): void {
  window.alert(translateUiText(message, getLanguage(), protectedCopy()));
}

export function syncDocumentLanguage(): void {
  document.documentElement.lang = getLanguage();
  for (const [selector, copy] of [
    [".skip-link", "Skip to main content"],
    ["#stuck p", "WealthUp could not finish loading."],
    ["#stuck-reload", "Reload"],
  ]) {
    const element = document.querySelector(selector);
    if (element) element.textContent = t(copy);
  }
}

/** Browser validation bubbles otherwise follow Chrome's language, not the app's. */
export function nativeValidationMessage(validity: ValidityState, minimum: string, maximum: string): string {
  if (validity.valueMissing) return "请填写此项。";
  if (validity.typeMismatch) return "请输入正确格式的内容。";
  if (validity.badInput) return "请输入有效数字。";
  if (validity.rangeUnderflow) return `请输入不小于 ${minimum} 的数值。`;
  if (validity.rangeOverflow) return `请输入不大于 ${maximum} 的数值。`;
  if (validity.stepMismatch) return "请输入符合此字段小数位数或步长的数值。";
  if (validity.tooShort) return "输入内容过短，请补充后重试。";
  if (validity.tooLong) return "输入内容过长，请缩短后重试。";
  return "请按此字段要求填写。";
}

/** Handles async market labels, calculator renders, sheets and toasts as well as pages. */
export function startInterfaceLanguage(getState: () => WealthState): () => void {
  activeState = getState;
  setProtectedValuesProvider(protectedCopy);
  syncDocumentLanguage();
  const validationCopies = new WeakMap<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, string>();
  const formControl = (target: EventTarget | null): target is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
  const onInvalid = (event: Event): void => {
    const field = event.target;
    if (getLanguage() !== "zh-CN" || !formControl(field) || field.validity.customError) return;
    const message = nativeValidationMessage(field.validity, field.getAttribute("min") ?? "", field.getAttribute("max") ?? "");
    field.setCustomValidity(message);
    validationCopies.set(field, message);
  };
  const clearValidation = (event: Event): void => {
    const field = event.target;
    if (!formControl(field)) return;
    const ownMessage = validationCopies.get(field);
    if (ownMessage && field.validationMessage === ownMessage) field.setCustomValidity("");
    validationCopies.delete(field);
  };
  document.addEventListener("invalid", onInvalid, true);
  document.addEventListener("input", clearValidation, true);
  document.addEventListener("change", clearValidation, true);
  const observer = new MutationObserver((records) => {
    const roots = new Set<Node>();
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach((node) => roots.add(node));
      else roots.add(record.target);
    }
    const copy = protectedCopy();
    for (const node of roots) if (node.isConnected) localizeInterface(node, copy);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...translatedAttributes] });
  localizeInterface(document.body, protectedCopy());
  return () => {
    observer.disconnect();
    document.removeEventListener("invalid", onInvalid, true);
    document.removeEventListener("input", clearValidation, true);
    document.removeEventListener("change", clearValidation, true);
    activeState = null; cachedState = null; protectedValues = []; setProtectedValuesProvider(() => []);
  };
}
