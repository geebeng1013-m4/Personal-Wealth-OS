import puppeteer from "puppeteer";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE_URL = "https://personal-wealth-os-demo.vercel.app";
const AUDIT_DIR = join(process.cwd(), "design-audit");

const MOBILE_W = 390;
const MOBILE_H = 844;

const pages = [
  { id: "dashboard",   name: "01-dashboard",   label: "Overview" },
  { id: "advisor",     name: "02-advisor",      label: "Coach" },
  { id: "buckets",     name: "03-buckets",      label: "Money Plan" },
  { id: "goals",       name: "04-goals",        label: "Goals" },
  { id: "rules",       name: "05-rules",        label: "Rules" },
  { id: "portfolio",   name: "06-portfolio",    label: "Investments" },
  { id: "market",      name: "07-market",       label: "Market" },
  { id: "calculator",  name: "08-calculator",   label: "Scenarios" },
  { id: "ledger",      name: "09-ledger",       label: "Activity" },
  { id: "review",      name: "10-review",       label: "Review" },
  { id: "settings",    name: "11-settings",     label: "Settings" },
];

const consoleErrors = [];
const pageErrors = [];
const results = [];

async function navigateToPage(page, id) {
  // Use JS to trigger navigation by clicking the nav button programmatically
  await page.evaluate((pageId) => {
    const btn = document.querySelector(`.nav-item[data-page="${pageId}"]`);
    if (btn) {
      btn.click();
    } else {
      // Try dispatching a custom navigation event
      window.location.hash = pageId;
    }
  }, id);
  await new Promise(r => setTimeout(r, 2000));
}

async function main() {
  console.log("=== Mobile Screenshots Capture ===\n");
  mkdirSync(AUDIT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  
  page.on("console", msg => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", err => pageErrors.push(err.message));

  await page.setViewport({ width: MOBILE_W, height: MOBILE_H });

  // Load the app
  console.log("--- Loading app at mobile viewport ---");
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector(".nav-item", { timeout: 15000 }).catch(() => null);
  await new Promise(r => setTimeout(r, 1000));

  // Try opening the hamburger menu first
  const hamburger = await page.$("#sidebarToggle, .hamburger, [aria-label*='navigation']");
  if (hamburger) {
    console.log("  Found hamburger menu, clicking...");
    await hamburger.click();
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: join(AUDIT_DIR, "12-mobile-menu.png"), fullPage: false });
    console.log("  ✓ Mobile menu open → 12-mobile-menu.png");
  }

  for (const p of pages) {
    try {
      console.log(`  Navigating to ${p.label}...`);
      await navigateToPage(page, p.id);
      
      // Close any mobile menu overlay that might be open
      const overlay = await page.$(".sidebar-overlay, .nav-overlay");
      if (overlay) {
        await overlay.click().catch(() => {});
        await new Promise(r => setTimeout(r, 300));
      }
      
      const filename = `${p.name}-mobile.png`;
      await page.screenshot({ path: join(AUDIT_DIR, filename), fullPage: true });
      console.log(`  ✓ ${p.label} → ${filename}`);
      results.push({ page: p.label, id: p.id, filename, status: "ok" });
    } catch (e) {
      console.log(`  ✗ ${p.label} failed: ${e.message}`);
      results.push({ page: p.label, id: p.id, status: "error", error: e.message });
    }
  }

  const summary = {
    viewport: { width: MOBILE_W, height: MOBILE_H },
    pages: results,
    pageErrors,
    consoleErrors,
  };

  const { writeFileSync } = await import("fs");
  writeFileSync(join(AUDIT_DIR, "mobile-report.json"), JSON.stringify(summary, null, 2));
  console.log("\n✓ Mobile report saved");

  await browser.close();
  console.log("=== Mobile Capture Complete ===");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});