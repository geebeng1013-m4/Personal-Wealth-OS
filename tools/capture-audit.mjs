import puppeteer from "puppeteer";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE_URL = "https://personal-wealth-os-demo.vercel.app";
const AUDIT_DIR = join(process.cwd(), "design-audit");

const DESKTOP_W = 1440;
const DESKTOP_H = 900;
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

const results = [];

async function capturePage(browser, page, pageInfo, viewport, suffix) {
  const { id, name, label } = pageInfo;
  await page.setViewport(viewport);
  
  // Navigate to base URL first
  if (suffix === "desktop") {
    await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
    // Wait for app shell to render
    await page.waitForSelector(".nav-item", { timeout: 15000 }).catch(() => null);
  }
  
  // Click the nav button for this page
  const navSelector = `.nav-item[data-page="${id}"]`;
  const navBtn = await page.$(navSelector);
  if (!navBtn) {
    console.log(`  ⚠ Nav button not found for "${id}" - trying URL hash`);
    await page.goto(`${BASE_URL}#${id}`, { waitUntil: "networkidle2", timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
  } else {
    await navBtn.click();
    // Wait for content to render
    await new Promise(r => setTimeout(r, 1500));
  }
  
  // Capture console errors
  const consoleErrors = [];
  page.on("console", msg => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  
  // Take full page screenshot
  const filename = `${name}-${suffix}.png`;
  const filepath = join(AUDIT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  
  console.log(`  ✓ ${label} (${suffix}) → ${filename}`);
  
  return {
    page: label,
    id,
    suffix,
    filename,
    consoleErrors: [...consoleErrors],
  };
}

async function main() {
  console.log("=== WealthUp Design Audit - Screenshot Capture ===\n");
  mkdirSync(AUDIT_DIR, { recursive: true });
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  
  const page = await browser.newPage();
  
  // Collect all console messages
  const allConsoleMessages = [];
  page.on("console", msg => {
    allConsoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  
  // Collect page errors
  const pageErrors = [];
  page.on("pageerror", err => {
    pageErrors.push(err.message);
  });
  
  // Desktop captures
  console.log("--- Desktop (1440x900) ---");
  for (const p of pages) {
    const result = await capturePage(browser, page, p, { width: DESKTOP_W, height: DESKTOP_H }, "desktop");
    results.push(result);
  }
  
  // Also capture sidebar expanded
  console.log("\n--- Sidebar & Components ---");
  await page.setViewport({ width: DESKTOP_W, height: DESKTOP_H });
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector(".nav-item", { timeout: 15000 }).catch(() => null);
  
  // Capture sidebar
  try {
    const sidebar = await page.$(".sidebar, nav, [class*=sidebar]");
    if (sidebar) {
      const box = await sidebar.boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        await sidebar.screenshot({ path: join(AUDIT_DIR, "12-sidebar.png") });
        console.log("  ✓ Sidebar → 12-sidebar.png");
      } else {
        console.log("  ⚠ Sidebar not visible (zero-size bounding box)");
      }
    } else {
      console.log("  ⚠ Sidebar element not found");
    }
  } catch (e) {
    console.log(`  ⚠ Sidebar capture failed: ${e.message}`);
  }
  
  // Mobile captures
  console.log("\n--- Mobile (390x844) ---");
  for (const p of pages) {
    const result = await capturePage(browser, page, p, { width: MOBILE_W, height: MOBILE_H }, "mobile");
    results.push(result);
  }
  
  // Capture modals/overlays on settings page
  console.log("\n--- Special States ---");
  await page.setViewport({ width: DESKTOP_W, height: DESKTOP_H });
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector(".nav-item", { timeout: 15000 }).catch(() => null);
  
  // Navigate to settings to look for modals
  const settingsBtn = await page.$('.nav-item[data-page="settings"]');
  if (settingsBtn) {
    await settingsBtn.click();
    await new Promise(r => setTimeout(r, 1500));
    
    // Look for import/export buttons or modals
    const buttons = await page.$$("button");
    for (const btn of buttons) {
      const text = await btn.evaluate(el => el.textContent);
      if (text && (text.includes("Import") || text.includes("Export") || text.includes("Snapshot"))) {
        await btn.click();
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: join(AUDIT_DIR, "13-settings-modal.png"), fullPage: true });
        console.log(`  ✓ Settings modal (${text.trim()}) → 13-settings-modal.png`);
        // Close modal if there is one
        const closeBtn = await page.$('.modal-close, [aria-label="Close"], button:has-text("Cancel")');
        if (closeBtn) await closeBtn.click();
        break;
      }
    }
  }
  
  // Collect summary
  const summary = {
    totalPages: pages.length,
    desktopCaptures: pages.length,
    mobileCaptures: pages.length,
    totalScreenshots: pages.length * 2 + 2,
    pageErrors: pageErrors,
    consoleErrors: allConsoleMessages.filter(m => m.type === "error"),
    consoleWarnings: allConsoleMessages.filter(m => m.type === "warning"),
    pages: results,
  };
  
  // Write report
  const reportPath = join(AUDIT_DIR, "audit-report.json");
  const { writeFileSync } = await import("fs");
  writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(`\n✓ Report → ${reportPath}`);
  
  await browser.close();
  console.log("\n=== Capture Complete ===");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});