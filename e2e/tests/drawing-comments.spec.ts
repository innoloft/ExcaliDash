import { test, expect } from "@playwright/test";
import {
  API_URL,
  createDrawing,
  deleteDrawing,
  getCsrfHeaders,
} from "./helpers/api";

/**
 * E2E coverage for pinned drawing comments:
 * - a pin placed on the canvas persists and reappears after a reload
 * - replies show up under the thread
 * - resolving hides the pin until "Show resolved" is ticked
 */

const revealEditorHeader = async (page: import("@playwright/test").Page) => {
  await page.mouse.move(24, 2);
  await page.waitForTimeout(200);
};

const openCommentsPanel = async (page: import("@playwright/test").Page) => {
  await revealEditorHeader(page);
  await page.getByTitle("Comments").click();
};

test.describe("Drawing Comments", () => {
  let createdDrawingIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdDrawingIds) {
      try {
        await deleteDrawing(request, id);
      } catch {}
    }
    createdDrawingIds = [];
  });

  test("places a comment pin on the canvas and keeps it after a reload", async ({
    page,
    request,
  }) => {
    const drawing = await createDrawing(request, { name: "Comments Test" });
    createdDrawingIds.push(drawing.id);

    await page.goto(`/editor/${drawing.id}`);
    await page.waitForSelector("canvas", { timeout: 20000 });
    await page.waitForTimeout(1000);

    await openCommentsPanel(page);
    await page.getByRole("button", { name: /Add comment/i }).click();
    await page.mouse.click(600, 450);

    const composer = page.getByPlaceholder("Add a comment…");
    await composer.waitFor({ timeout: 5000 });
    await composer.fill("Please double-check this arrow");
    await page.getByRole("button", { name: "Comment", exact: true }).click();

    const pin = page.locator('button[title*="Please double-check this arrow"]');
    await expect(pin).toHaveCount(1);

    const stored = await request.get(`${API_URL}/drawings/${drawing.id}/comments`);
    expect(stored.ok()).toBe(true);
    const storedBody = await stored.json();
    expect(storedBody.comments).toHaveLength(1);
    expect(storedBody.comments[0].parentId).toBeNull();

    await page.reload();
    await page.waitForSelector("canvas", { timeout: 20000 });
    await expect(pin).toHaveCount(1);
  });

  test("shows a reply in the thread and hides a resolved thread", async ({
    page,
    request,
  }) => {
    const drawing = await createDrawing(request, { name: "Comment Thread" });
    createdDrawingIds.push(drawing.id);

    const csrfHeaders = await getCsrfHeaders(request);
    const created = await request.post(
      `${API_URL}/drawings/${drawing.id}/comments`,
      {
        headers: csrfHeaders,
        data: { body: "Root comment", x: 40, y: 60 },
      },
    );
    expect(created.status()).toBe(201);
    const root = await created.json();

    await page.goto(`/editor/${drawing.id}`);
    await page.waitForSelector("canvas", { timeout: 20000 });
    await openCommentsPanel(page);

    await page.getByText("Root comment").first().click();
    const reply = page.getByPlaceholder("Reply…").first();
    await reply.fill("Answered");
    await page.getByRole("button", { name: "Reply", exact: true }).first().click();
    await expect(page.locator("p", { hasText: "Answered" }).first()).toBeVisible();

    await expect
      .poll(async () => {
        const response = await request.get(
          `${API_URL}/drawings/${drawing.id}/comments`,
        );
        const payload = await response.json();
        return payload.comments.filter((c: any) => c.parentId === root.id)
          .length;
      })
      .toBe(1);

    await page.getByRole("button", { name: /Resolve/i }).first().click();
    await expect(
      page.locator('button[title*="Root comment"]'),
    ).toHaveCount(0);

    await page.getByLabel(/Show resolved/i).check();
    await expect(page.locator('button[title*="Root comment"]')).toHaveCount(1);
  });
});
