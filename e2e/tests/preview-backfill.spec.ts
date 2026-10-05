import { expect, test } from "@playwright/test";
import { createDrawing, deleteDrawing, getDrawing } from "./helpers/api";

// Drawings created through the API (as the MCP endpoint does) have no preview.
// The dashboard renders one once and stores it, without counting as an edit.
test("dashboard stores a preview for drawings created without one", async ({
  page,
  request,
}) => {
  const drawing = await createDrawing(request, {
    name: `Preview backfill ${Date.now()}`,
    elements: [
      {
        id: "backfill-rect",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 200,
        height: 120,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "#a5d8ff",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
      },
    ],
  });
  try {
    const before = await getDrawing(request, drawing.id);
    expect(before.preview ?? null).toBeNull();

    await page.goto("/");
    const card = page.locator(`#drawing-card-${drawing.id}`);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("img.drawing-preview-image")).toBeVisible();

    await expect
      .poll(async () => (await getDrawing(request, drawing.id)).preview ?? null)
      .toContain("<svg");
    const after = await getDrawing(request, drawing.id);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.version).toEqual(before.version);

    // The next visit uses the stored preview instead of the full scene.
    let fullDrawings = 0;
    page.on("request", (sent) => {
      if (
        sent.method() === "GET" &&
        new URL(sent.url()).pathname.endsWith(`/drawings/${drawing.id}`)
      )
        fullDrawings++;
    });
    await page.reload();
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("img.drawing-preview-image")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(fullDrawings).toBe(0);
  } finally {
    await deleteDrawing(request, drawing.id);
  }
});
