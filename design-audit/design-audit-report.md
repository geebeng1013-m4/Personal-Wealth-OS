# WealthUp Design Audit Report
**Date:** 2026-08-17
**URL:** https://personal-wealth-os-demo.vercel.app
**Pages Audited:** 11 pages across 5 sidebar groups

---

## Executive Summary

WealthUp is a personal finance SPA built with Vite + vanilla TypeScript. The visual design is polished with a modern glass-morphism aesthetic, timeline-based navigation, and a dark-mode-first approach. The app has a strong foundation but several areas need attention for production readiness.

**Overall Score: 7.5/10**

| Category | Score | Notes |
|----------|-------|-------|
| Visual Consistency | 8/10 | Strong design system with CSS custom properties |
| Responsive Design | 6/10 | Breakpoints exist but several gaps at edge sizes |
| Accessibility | 5/10 | Missing ARIA labels, focus states, contrast issues |
| Component Quality | 8/10 | Well-structured cards, badges, buttons |
| Typography | 8/10 | Inter font hierarchy is clear and consistent |
| Color System | 7/10 | Good green accent but some hardcoded colors remain |
| Information Density | 7/10 | Generally good but some pages are dense |
| Navigation | 8/10 | Timeline nav is distinctive; mobile hamburger works |

---

## 1. Visual Design & Branding

### ✅ Strengths
- **Consistent glass-morphism aesthetic**: `.card` uses `backdrop-filter: blur(24px)` with subtle glass borders
- **Strong brand identity**: Logo treatment in sidebar with gradient mark and glow shadow
- **Well-defined color palette**: 8 semantic CSS custom properties (`--green`, `--cyan`, `--amber`, `--red`, etc.)
- **Distinctive sidebar navigation**: Timeline-style with node indicators, gradient connection lines, and glow effects on active state
- **Metric cards**: Dashboard uses gradient backgrounds per card (cyan, blue, green, amber, purple)

### ⚠️ Issues Found

| # | Severity | Issue | Location |
|---|----------|-------|----------|
| 1.1 | Medium | Hardcoded color values (`#22405a`, `#162a40`, `#d9e3ea`) not using CSS variables | `.sidebar`, `.nav`, `.nav-item` |
| 1.2 | Low | `--nav-radius: 24px` and `--radius-lg: 22px` are very similar, could consolidate | `:root` |
| 1.3 | Low | `.eyebrow` text-transform is uppercase which may hurt readability for CJK characters | Global |
| 1.4 | Medium | Some components use inline colors rather than design tokens (e.g., `.goal-card-status` hardcodes green/amber/red) | Goals page |

---

## 2. Responsive Design

### Breakpoint Map (from CSS)
```
1120px → wealth-hero collapses to 1 column
1100px → ledger layout collapses to 1 column
1080px → metric-grid becomes 2 columns
900px  → wealth-metrics & ledger-summary collapse
768px  → market ticker badge reflows
720px  → sidebar hides → mobile nav appears, main layout collapses
680px  → root font-size decreases, market header reflows
480px  → login card max-width adjustment
400px  → further padding reduction, ledger header grid
390px  → main padding minimum
```

### ⚠️ Issues Found

| # | Severity | Issue | Details |
|---|----------|-------|---------|
| 2.1 | **High** | Sidebar collapse at 720px is abrupt | No intermediate "collapsed sidebar" state between 720px–1080px. On tablets (768px–1024px), the full sidebar takes ~36% of viewport width |
| 2.2 | **High** | No tablet-specific layout | iPad portrait (768px) gets full sidebar + cramped main content. Should show icon-only sidebar or bottom nav |
| 2.3 | Medium | `--main-min-pad: 20px` with `clamp()` is good, but some child components don't respect parent padding | Cards can overflow on 390px viewport |
| 2.4 | Medium | Market page ticker cards use fixed grid that may not reflow well at 400px–600px | `.market-ticker-grid: repeat(auto-fill, minmax(340px, 1fr))` |
| 2.5 | Low | Hero stat cards use `clamp(220px, 28%, 360px)` minimum — 4 cards at 28% could break at narrow desktops | Dashboard hero |
| 2.6 | Medium | Calculator uses Tailwind + separate `tailwind.css` file which creates styling inconsistency with the rest of the vanilla CSS app | Calculator page |

---

## 3. Accessibility (a11y)

### ⚠️ Issues Found

| # | Severity | Issue | Details |
|---|----------|-------|---------|
| 3.1 | **High** | Navigation items lack visible focus indicators in some states | `.nav-item:focus-visible` has `background: transparent` — no visible ring |
| 3.2 | **High** | Color-only status indicators | Goals, Portfolio, and Rules use color (green/amber/red) as the only differentiator — no icons or text labels for color-blind users |
| 3.3 | Medium | Skip-navigation link missing | No `<a href="#main">Skip to content</a>` for keyboard users |
| 3.4 | Medium | Card interactive elements may lack ARIA roles | `.card[role="button"]` exists in CSS but JS must ensure it's applied correctly |
| 3.5 | Medium | Logo image `alt` text should be meaningful | `.brand-logo-img` needs descriptive alt, not just "logo" |
| 3.6 | Low | Form inputs use `::placeholder` which has insufficient contrast in some browsers | Login/signup forms |
| 3.7 | Medium | Mobile hamburger button needs `aria-expanded` and `aria-controls` | `#sidebarToggle` |
| 3.8 | Low | `.market-badges` chip elements may not be announced as a group | Should use `role="group"` with `aria-label` |

---

## 4. Component-Specific Findings

### 4.1 Dashboard (Overview)
- ✅ Hero cards with gradient backgrounds are visually striking
- ✅ Metric grid collapses gracefully from 4→2→1 columns
- ⚠️ Health score circular progress indicator may have insufficient color contrast for the "fair" state (amber on dark bg)
- ⚠️ Suggestion cards could benefit from icons to distinguish severity levels

### 4.2 Coach (AI Advisor)
- ✅ Chat bubble layout with user/assistant differentiation works well
- ✅ Copy button on messages is a nice UX touch
- ⚠️ Predefined question buttons should have visible hover/active states
- ⚠️ Empty state needs illustration or more engaging CTA

### 4.3 Money Plan (Buckets)
- ✅ Overall/income/expense toggle is clear
- ✅ Progress bars in allocation cards are informative
- ⚠️ Bucket cards could get very tall on mobile with long descriptions
- ⚠️ Some bucket descriptions may overflow the `max-height: 40px` constraint

### 4.4 Goals
- ✅ Progress bars with percentage labels are clear
- ✅ Card layout with status badges works well
- ⚠️ Status badges use only color — need icons (✓, ⏳, ⚠)
- ⚠️ Long goal names may truncate without tooltip

### 4.5 Rules
- ✅ Traffic-light system (green/amber/red) is intuitive
- ✅ Card grid adapts to content
- ⚠️ Some rule descriptions may be too long for cards — consider expandable text
- ⚠️ The 3 status colors need text equivalents for a11y

### 4.6 Investments (Portfolio)
- ✅ Ticker search with results dropdown is good UX
- ✅ Holdings table with gain/loss coloring is standard financial UI
- ⚠️ Table may overflow horizontally on mobile — needs horizontal scroll indicator
- ⚠️ P/L column uses red for losses which may conflict with the global `--red` meaning

### 4.7 Market
- ✅ Ticker cards with mini price charts are informative
- ✅ Search bar is prominently placed
- ⚠️ Price change badges duplicate color + arrow + percentage — could be more compact
- ⚠️ Chart loading states need skeleton/placeholder

### 4.8 Calculator (Scenarios)
- ⚠️ Uses Tailwind CSS in a vanilla CSS app — creates visual inconsistency
- ⚠️ Input styling may differ from the rest of the app's `.input-text` class
- ✅ Tab switching between calculator modes is clean

### 4.9 Activity (Ledger)
- ✅ Two-column layout (form + entries) is efficient on desktop
- ✅ Entry cards with type badges and category pills are well-structured
- ⚠️ Date grouping headers could be sticky for better context
- ⚠️ Mobile layout stacking is correct but form takes significant vertical space

### 4.10 Review
- ✅ Monthly review with navigation is a strong feature
- ⚠️ May need loading state when switching months
- ⚠️ Summary stats should use consistent number formatting

### 4.11 Settings
- ✅ Clean form layout with clear labels
- ✅ Theme toggle is prominently placed
- ⚠️ Danger zone (delete data) needs stronger visual separation
- ⚠️ Form groups could benefit from description text

---

## 5. Typography

### Font Stack
- Primary: Inter (Google Fonts) with system fallbacks
- Tabular numbers enabled via `font-feature-settings: "tnum"`
- Loading strategy: 3 weights (500, 600, 800) — good optimization

### Scale (from CSS)
| Token | Size | Usage |
|-------|------|-------|
| `.section-title` | 20px, 800 weight | Page headings |
| `.card-title` | 14px, 650 weight | Card headings |
| `.card-value` | 22px, 750 weight | Large metric values |
| `.eyebrow` | 10px, 600 weight, uppercase | Section labels |
| Body default | 14px, 500 weight | General text |
| Small/meta | 12px, 400 weight | Secondary info |

### ⚠️ Issues
| # | Issue |
|---|-------|
| 5.1 | `.card-value` at 22px may be too small for dashboard hero metrics — consider 28–32px |
| 5.2 | `.eyebrow` at 10px uppercase may be hard to read on low-res screens |
| 5.3 | No fluid typography — sizes are fixed across all viewports |

---

## 6. Color & Theme

### Light Theme Variables
| Variable | Value | Usage |
|----------|-------|-------|
| `--bg` | `#f2f6f8` | Page background |
| `--surface` | `rgba(255,255,255,0.72)` | Card backgrounds |
| `--nav` | `#dce6eb` | Sidebar background |
| `--ink` | `#0b2540` | Primary text |
| `--green` | `#22c55e` | Primary accent |
| `--cyan` | `#06b6d4` | Secondary accent |
| `--line` | `rgba(11,37,64,0.08)` | Borders |

### Dark Theme
- ✅ Fully implemented via `html.dark` overrides
- ✅ Cards use darker glass-morphism (`rgba(22,42,64,0.65)`)
- ✅ Logo switches to white variant automatically

### ⚠️ Issues
| # | Issue |
|---|-------|
| 6.1 | Some component colors are not theme-aware (hardcoded hex values) |
| 6.2 | Dark mode card backgrounds use `rgba(22,42,64,0.65)` — the opacity may cause readability issues with overlapping cards |
| 6.3 | No high-contrast mode option for accessibility |
| 6.4 | `--glass-border` in dark mode (`rgba(255,255,255,0.08)`) may be too subtle |

---

## 7. Spacing & Layout

### Global Spacing System
| Token | Value | Usage |
|-------|-------|-------|
| `--gap-xs` | 4px | Tight gaps |
| `--gap-s` | 8px | Small gaps |
| `--gap` | 14px | Standard gaps |
| `--gap-m` | 18px | Medium gaps |
| `--gap-l` | 24px | Section gaps |
| `--radius` | 14px | Standard border-radius |
| `--radius-lg` | 22px | Large border-radius |
| `--radius-sm` | 10px | Small border-radius |

### ✅ Strengths
- Consistent spacing tokens throughout
- `clamp()` used for responsive padding on `.main` and `.login-card`
- Grid-based layouts with proper `min-width: 0` for overflow prevention

### ⚠️ Issues
| # | Issue |
|---|-------|
| 7.1 | `--gap` (14px) and `--gap-m` (18px) are very close — consider removing one |
| 7.2 | Card padding varies (`16px`, `18px`, `20px`) — should be standardized to `var(--gap)` or `var(--gap-m)` |
| 7.3 | Some components use `gap: 6px` which isn't a design token |

---

## 8. Animations & Transitions

### Global Transition
- `--transition: 0.2s ease` applied to most interactive elements
- ✅ Cards use `transform` on hover for subtle lift effect
- ✅ Nav items have `translateX` animation on hover/active
- ✅ Sidebar group items stagger entrance with CSS-only animation
- ✅ `@keyframes navDotPulse` for active nav node glow

### ⚠️ Issues
| # | Issue |
|---|-------|
| 8.1 | No `prefers-reduced-motion` media query — animations should be disabled for users who prefer reduced motion |
| 8.2 | Multiple `transition` declarations on `.nav-item` could be consolidated |
| 8.3 | Card hover `transform: translateY(-2px)` may cause layout shifts if cards are in a grid |

---

## 9. Performance Observations

| # | Finding |
|---|---------|
| 9.1 | Inter font loaded from Google Fonts with `display=swap` — good |
| 9.2 | Only 3 font weights requested (500, 600, 800) — efficient |
| 9.3 | CSS uses `will-change: background-position, opacity` which is appropriate |
| 9.4 | `backdrop-filter: blur()` used extensively — may cause GPU strain on low-end devices |
| 9.5 | Chart.js loaded for market charts — consider lazy loading |
| 9.6 | Service Worker (`sw.js`) present for PWA caching |

---

## 10. Recommendations (Priority Order)

### 🔴 Critical (Fix Before Launch)
1. **Add `prefers-reduced-motion` support** — Wrap animations in `@media (prefers-reduced-motion: no-preference)`
2. **Fix color-only status indicators** — Add icons/text alongside color for accessibility
3. **Improve focus visibility** — Add visible focus rings to all interactive elements
4. **Add skip-navigation link** — Essential for keyboard/screen reader users
5. **Fix tablet breakpoint** — Add intermediate sidebar state (icon-only) between 720px–1080px

### 🟡 Important (Fix Soon)
6. **Standardize card padding** — Use design tokens consistently
7. **Add ARIA attributes** — `aria-expanded`, `aria-controls`, `aria-label` on interactive elements
8. **Unify Calculator styling** — Either migrate to Tailwind globally or remove it from calculator
9. **Add loading/skeleton states** — For charts, data tables, and async content
10. **Audit hardcoded colors** — Move all remaining hex values to CSS custom properties

### 🟢 Nice to Have
11. **Add fluid typography** — Use `clamp()` for heading sizes
12. **Consolidate spacing tokens** — Remove `--gap-m`, standardize on `--gap` and `--gap-l`
13. **Add empty state illustrations** — For pages with no data
14. **Improve dark mode contrast** — Increase glass border opacity in dark theme
15. **Add high-contrast mode** — For users who need it

---

## Screenshots Captured

### Desktop (1440×900)
| # | File | Page |
|---|------|------|
| 1 | `01-dashboard-desktop.png` | Overview |
| 2 | `02-advisor-desktop.png` | Coach |
| 3 | `03-buckets-desktop.png` | Money Plan |
| 4 | `04-goals-desktop.png` | Goals |
| 5 | `05-rules-desktop.png` | Rules |
| 6 | `06-portfolio-desktop.png` | Investments |
| 7 | `07-market-desktop.png` | Market |
| 8 | `08-calculator-desktop.png` | Scenarios |
| 9 | `09-ledger-desktop.png` | Activity |
| 10 | `10-review-desktop.png` | Review |
| 11 | `11-settings-desktop.png` | Settings |

### Mobile (390×844)
| # | File | Page |
|---|------|------|
| 12 | `12-mobile-menu.png` | Menu open state |
| 13 | `01-dashboard-mobile.png` | Overview |
| 14 | `02-advisor-mobile.png` | Coach |
| 15 | `03-buckets-mobile.png` | Money Plan |
| 16 | `04-goals-mobile.png` | Goals |
| 17 | `05-rules-mobile.png` | Rules |
| 18 | `06-portfolio-mobile.png` | Investments |
| 19 | `07-market-mobile.png` | Market |
| 20 | `08-calculator-mobile.png` | Scenarios |
| 21 | `09-ledger-mobile.png` | Activity |
| 22 | `10-review-mobile.png` | Review |
| 23 | `11-settings-mobile.png` | Settings |

---

## Technical Notes

- **Framework:** Vite 5 + vanilla TypeScript (no React/Vue)
- **Styling:** Vanilla CSS with CSS custom properties + Tailwind (calculator only)
- **Charts:** Chart.js + lightweight-charts
- **Backend:** Firebase Auth + Firestore
- **PWA:** Service Worker with caching strategy
- **Deployment:** Vercel

Report generated by automated design audit tooling.