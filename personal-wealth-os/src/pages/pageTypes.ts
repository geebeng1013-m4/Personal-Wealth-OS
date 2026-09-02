/**
 * The contract between the shell (ui.ts) and an extracted page module.
 *
 * Every bind* function re-renders after it changes state, and re-rendering is
 * the shell's job. If a page module imported renderApp to do it, the shell and
 * each of its pages would import each other — so the shell hands its own
 * renderApp down as `rerender` instead, and the dependency stays one-way:
 * ui.ts knows about its pages, its pages know nothing about it.
 */

import type { WealthState } from "../models";

export type Setter = (state: WealthState, changeLabel?: string) => void;
export type Navigate = (page: string) => void;

export interface SessionUser {
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
}

/** The shell's renderApp, as a page module sees it. */
export type RenderApp = (
  root: HTMLElement,
  state: WealthState,
  setState: Setter,
  activePage?: string,
  navigate?: Navigate,
  user?: SessionUser,
  onLogout?: () => void,
) => void;
