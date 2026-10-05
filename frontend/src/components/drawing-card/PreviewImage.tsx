import React, { useEffect, useState } from "react";
import clsx from "clsx";
import excalifontUrl from "../../assets/fonts/Excalifont-Regular.woff2?url";
import { useTheme } from "../../context/ThemeContext";
import {
  previewNeedsExcalifont,
  previewSvgForImage,
} from "../../utils/previewSvg";

let excalifontDataUrl: Promise<string | undefined> | null = null;

// Loaded once, and only when a thumbnail actually contains text.
const loadExcalifontDataUrl = (): Promise<string | undefined> =>
  (excalifontDataUrl ??= fetch(excalifontUrl)
    .then((response) => (response.ok ? response.blob() : Promise.reject()))
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => undefined));

// Upper bound of a card's preview area in CSS pixels; rasters are rendered at
// up to 2x that for high-density screens.
const RASTER_BOX = { width: 400, height: 250 };

type Rendered = { src: string; width: number; height: number };

// Draws the SVG once into a bitmap. WebKit repaints SVG images (inline or as
// <img>) vector by vector on every scroll frame; a bitmap is a cheap blit.
const rasterize = async (svgUrl: string): Promise<Rendered> => {
  const image = new Image();
  image.src = svgUrl;
  await image.decode();
  const width = image.naturalWidth || RASTER_BOX.width;
  const height = image.naturalHeight || RASTER_BOX.height;
  const density = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(
    (RASTER_BOX.width * density) / width,
    (RASTER_BOX.height * density) / height,
    density,
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Canvas encoding failed");
  return { src: URL.createObjectURL(blob), width, height };
};

interface PreviewImageProps {
  svg: string;
  className?: string;
}

// Thumbnails are drawn as images rather than inlined into the page. An inline
// Excalidraw export adds thousands of nodes to the document and is repainted
// in full on every hover, scroll and theme filter; Safari in particular grinds
// to a halt on a full dashboard.
export const PreviewImage: React.FC<PreviewImageProps> = ({
  svg,
  className,
}) => {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [rendered, setRendered] = useState<Rendered | null>(null);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    const render = async () => {
      const excalifont = previewNeedsExcalifont(svg)
        ? await loadExcalifontDataUrl()
        : undefined;
      if (cancelled) return;
      const svgUrl = URL.createObjectURL(
        new Blob(
          [previewSvgForImage(svg, { dark, excalifontDataUrl: excalifont })],
          { type: "image/svg+xml" },
        ),
      );
      urls.push(svgUrl);
      let next: Rendered;
      try {
        next = await rasterize(svgUrl);
        urls.push(next.src);
        URL.revokeObjectURL(svgUrl);
      } catch {
        // Fall back to the vector image if the browser can't rasterize it.
        next = { src: svgUrl, width: 0, height: 0 };
      }
      if (!cancelled) setRendered(next);
    };
    void render();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [svg, dark]);

  if (!rendered) return null;
  return (
    <img
      src={rendered.src}
      alt=""
      draggable={false}
      decoding="async"
      // Keep the drawing's own size as the layout size, as the inline SVG had;
      // the bitmap behind it may be denser.
      style={
        rendered.width
          ? { width: rendered.width, height: rendered.height }
          : undefined
      }
      className={clsx("drawing-preview-image object-contain", className)}
    />
  );
};
