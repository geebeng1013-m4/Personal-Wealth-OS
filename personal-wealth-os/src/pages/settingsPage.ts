/**
 * Settings page — how the app behaves: privacy, the data tools and reset.
 * Everything about the user and their money lives on the Me page.
 *
 * The data tools — theme, add to home screen, export, import, version history
 * and reset — render here as rows; their handlers are bound in ui.ts
 * (bindCommon) by data-tool, because they reach beyond this page (the theme
 * re-renders the shell, reset and import replace the whole state).
 */

import type { WealthState } from "../models";
import { pageHeader } from "../components/pageHeader";
import type { Navigate, RenderApp, Setter } from "./pageTypes";
import { bindRowPage, group } from "./settingsRows";
import { isDemoMode } from "../demo";
import { getLanguage, t } from "../i18n";

/** A switch row: flipping it saves straight away. */
function toggleRow(name: "maskAmounts" | "requireExportConfirmation", title: string, checked: boolean): string {
  return `<li class="wu-set__item"><label class="wu-set__row wu-set__row--static">
      <span class="wu-set__title">${title}</span>
      <span class="wu-switch"><input type="checkbox" data-privacy="${name}"${checked ? " checked" : ""}><span class="wu-switch__track"></span></span>
    </label></li>`;
}

/** A data-tool row; ui.ts binds the behaviour. */
function toolRow(tool: string, title: string, value = ""): string {
  if (tool === "import") {
    return `<li class="wu-set__item"><label class="wu-set__row file-button"><span class="wu-set__title">${title}</span><span class="wu-set__value">${value}<span class="wu-set__chev" aria-hidden="true">›</span></span><input data-tool="import" type="file" accept="application/json" aria-label="${t("Import data")}"></label></li>`;
  }
  return `<li class="wu-set__item"><button class="wu-set__row" data-tool="${tool}" type="button"><span class="wu-set__title">${title}</span><span class="wu-set__value">${value}<span class="wu-set__chev" aria-hidden="true">›</span></span></button></li>`;
}

export function settingsTemplate(state: WealthState): string {
  const theme = t(typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light" ? "Light" : "Dark");

  const privacyRows = [
    toggleRow("maskAmounts", t("Mask amounts on screen"), state.privacy.maskAmounts),
    toggleRow("requireExportConfirmation", t("Confirm before exporting"), state.privacy.requireExportConfirmation),
  ].join("");

  const dataRows = [
    `<li class="wu-set__item"><label class="wu-set__row wu-language-row" for="appLanguage"><span class="wu-set__title">${t("Language")}<small>${t("Applies to this browser.")}</small></span><select class="wu-field wu-language-select" id="appLanguage" data-language><option value="en" lang="en"${getLanguage() === "en" ? " selected" : ""}>English</option><option value="zh-CN" lang="zh-CN"${getLanguage() === "zh-CN" ? " selected" : ""}>简体中文</option></select></label><p class="t-caption t-negative" id="languageError" role="alert" hidden></p></li>`,
    toolRow("theme", t("Theme"), theme),
    toolRow("export", t("Export data")),
    toolRow("import", t("Import data")),
    toolRow("version", t("Version history")),
    toolRow("install", t("Add to Home Screen")),
  ].join("");

  return `
    <div class="wu wu-settings-page">
      ${pageHeader({
        eyebrow: t("Configuration"),
        title: t("Settings"),
        sub: t("Privacy, your data and how the app looks."),
      })}
      <div class="wu-dash wu-settings">
        ${group("setPrivacyLabel", t("Privacy"), privacyRows, "wu-set--privacy")}
        ${group("setDataLabel", t("Data"), dataRows, "wu-set--data")}
        ${isDemoMode() ? "" : dangerZone()}
      </div>
    </div>
  `;
}

/** Not in the demo: its banner's Reset demo already restores the sample data, and there is no cloud copy to clear. */
function dangerZone(): string {
  return `
        <section class="wu-card wu-dash__half wu-set wu-set--danger" aria-labelledby="setDangerLabel">
          <div class="wu-tc__top wu-set__head"><span class="wu-label" id="setDangerLabel">${t("Danger zone")}</span></div>
          <p class="wu-dash__note wu-set__danger-note">${t("Reset clears every record on this device and in the cloud. A copy is saved to Version History first.")}</p>
          <div class="wu-dash__actions wu-set__danger-desk"><button class="wu-btn wu-btn--danger wu-btn--sm" data-tool="reset" type="button">${t("Reset all data")}</button></div>
          <ul class="wu-set__list wu-set__danger-phone"><li class="wu-set__item"><button class="wu-set__row" data-tool="reset" type="button"><span class="wu-set__title t-negative">${t("Reset all data")}</span></button></li></ul>
        </section>`;
}

export function bindSettings(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  const { repaint } = bindRowPage(root, state, setState, navigate, rerender, "settings");

  // Privacy switches save the moment they flip.
  root.querySelectorAll<HTMLInputElement>("[data-privacy]").forEach((input) => input.addEventListener("change", () => {
    const key = input.dataset.privacy as "maskAmounts" | "requireExportConfirmation";
    repaint({ ...state, privacy: { ...state.privacy, [key]: input.checked } }, true, "Update privacy settings");
  }));
}
