import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pagesDir = resolve(here, "..");

const PAGES = [
  "AccountsPage.tsx",
  "AccountTable.tsx",
  "SettingsPage.tsx",
  "PlaygroundPage.tsx",
];

// These four pages must use the B1 bflabs primitives (PascalCase <Input>,
// <Select>, <Textarea>, <Checkbox>, <Switch>) rather than raw browser
// form controls. Lowercase raw tags are forbidden.
describe("no raw form controls in console pages", () => {
  for (const page of PAGES) {
    const src = readFileSync(resolve(pagesDir, page), "utf8");

    it(`${page} has no raw <input>`, () => {
      expect(/<input[\s/>]/.test(src)).toBe(false);
    });

    it(`${page} has no raw <select>`, () => {
      expect(/<select[\s/>]/.test(src)).toBe(false);
    });

    it(`${page} has no raw <textarea>`, () => {
      expect(/<textarea[\s/>]/.test(src)).toBe(false);
    });
  }
});
