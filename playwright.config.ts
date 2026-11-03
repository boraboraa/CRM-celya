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
 * Cinq appareils × deux rôles : 390 × 844 (iPhone), 360 × 800 (Android),
 * l'iPad en portrait (820 × 1180) et en paysage (1180 × 820) — TACTILES
 * (3/11 : Colin travaille sur iPad, et un iPad paysage dépasse 1024 px) — et
 * 1280 × 900 à la souris pour la non-régression ordinateur.
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
/**
 * L'iPad (3/11) : tactile (`pointer: coarse`), mais PAS un téléphone — Safari
 * iPadOS se présente comme un Mac (agent « Macintosh »), sans `isMobile`.
 */
const SAFARI_IPADOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
const ipadPortrait = {
  viewport: { width: 820, height: 1180 },
  deviceScaleFactor: 2,
  isMobile: false,
  hasTouch: true,
  userAgent: SAFARI_IPADOS,
};
const ipadPaysage = { ...ipadPortrait, viewport: { width: 1180, height: 820 } };
const ordinateur = { viewport: { width: 1280, height: 900 } };

const appareils = {
  iphone,
  android,
  "ipad-portrait": ipadPortrait,
  "ipad-paysage": ipadPaysage,
  ordinateur,
} as const;
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
