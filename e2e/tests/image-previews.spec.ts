import { expect, test } from "@playwright/test";
import {
  createDrawing,
  deleteDrawing,
  getDrawing,
  updateDrawing,
} from "./helpers/api";

const dataURL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

for (const storedPreview of [false, true]) {
  test(`image thumbnail loads stored file bytes with ${storedPreview ? "a legacy" : "no"} preview`, async ({
    page,
    request,
  }) => {
    const drawing = await createDrawing(request, {
      name: `E2E thumbnail ${Date.now()}`,
      elements: [
        {
          id: "preview-image",
          type: "image",
          fileId: "preview-file",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          status: "pending",
          scale: [1, 1],
          version: 1,
          versionNonce: 1,
          angle: 0,
          opacity: 100,
          groupIds: [],
          frameId: null,
          crop: null,
          isDeleted: false,
          strokeColor: "transparent",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 0,
          seed: 1,
          roundness: null,
          boundElements: null,
          link: null,
          locked: false,
          updated: Date.now(),
        },
      ],
      files: {
        "preview-file": {
          id: "preview-file",
          mimeType: "image/png",
          dataURL,
          created: Date.now(),
        },
        "unused-file": {
          id: "unused-file",
          mimeType: "image/png",
          dataURL: "/api/files/missing-drawing/missing-file",
          created: Date.now(),
        },
      },
    });
    try {
      if (storedPreview) {
        // The old sanitizer dropped symbol/use, leaving an invisible image in defs.
        await updateDrawing(request, drawing.id, {
          preview: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><image href="/api/files/${drawing.id}/preview-file" width="100%" height="100%"/></defs></svg>`,
        });
      }
      await page.goto("/");
      const card = page.locator(`#drawing-card-${drawing.id}`);
      await card.scrollIntoViewIfNeeded();
      // Thumbnails are rasterized; the red test image must show up in pixels.
      const thumbnail = card.locator("img.drawing-preview-image");
      await expect(thumbnail).toHaveAttribute("src", /^blob:/);
      await expect
        .poll(() =>
          thumbnail.evaluate(async (img: HTMLImageElement) => {
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const context = canvas.getContext("2d")!;
            context.drawImage(img, 0, 0);
            return Array.from(
              context.getImageData(
                Math.floor(canvas.width / 2),
                Math.floor(canvas.height / 2),
                1,
                1,
              ).data,
            );
          }),
        )
        .toEqual([255, 0, 0, 255]);
      if (!storedPreview) {
        // The rendered preview is stored with a file reference, not the bytes.
        await expect
          .poll(async () => (await getDrawing(request, drawing.id)).preview)
          .toContain(`/api/files/${drawing.id}/preview-file`);
        expect((await getDrawing(request, drawing.id)).preview).not.toContain(
          "data:image/png",
        );
      }
    } finally {
      await deleteDrawing(request, drawing.id);
    }
  });
}
