import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Le banc MOBILE (`npm run test:mobile`) — le seul test du dépôt qui demande
 * un serveur lancé et la base : il se connecte avec les deux comptes de test
 * (`mobile-commercial@celya.test`, `mobile-admin@celya.test`) et ne touche
 * qu'à leurs fiches « ZZ Test mobile », aux numéros fictifs.
 *
 *   E2E_BASE_URL            défaut http://localhost:3000 (`npm run build && npm start`)
 *   E2E_COMMERCIAL_EMAIL / E2E_COMMERCIAL_PASSWORD
 *   E2E_ADMIN_EMAIL      / E2E_ADMIN_PASSWORD
 *   PLAYWRIGHT_CHROMIUM     un Chromium déjà installé (sinon `npx playwright install chromium`)
 *
 * Trois tailles × deux rôles : 390 × 844 (iPhone), 360 × 800 (Android) et
 * 1280 × 900 pour la non-régression ordinateur.
 */
const chromium =
  process.env.PLAYWRIGHT_CHROMIUM ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const iphone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: devices["iPhone 13"].userAgent,
};
const android = {
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: devices["Galaxy S9+"].userAgent,
};
const ordinateur = { viewport: { width: 1280, height: 900 } };

const appareils = { iphone, android, ordinateur } as const;
const roles = ["commercial", "admin"] as const;

export default defineConfig({
  testDir: "./tests/mobile",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "fr-BE",
    timezoneId: "Europe/Brussels",
    launchOptions: chromium ? { executablePath: chromium } : {},
  },
  projects: [
    { name: "connexion", testMatch: /connexion\.setup\.ts/ },
    ...Object.entries(appareils).flatMap(([appareil, use]) =>
      roles.map((role) => ({
        name: `${appareil}-${role}`,
        dependencies: ["connexion"],
        testIgnore: /connexion\.setup\.ts/,
        metadata: { appareil, role },
        use: { ...use, storageState: `tests/mobile/.auth/${role}.json` },
      }))
    ),
  ],
});
