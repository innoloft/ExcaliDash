import React from "react";
import { MousePointer2 } from "lucide-react";
import { usePreference } from "../../context/PreferencesContext";

/**
 * Per-user editor preferences. Backed by the shared preferences store, so the
 * choice follows the account across devices and survives a reload.
 */
export const EditorPreferencesCard: React.FC = () => {
  const [scrollToZoom, setScrollToZoom] = usePreference("scrollToZoom", false);

  return (
    <div className="bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-indigo-50 dark:bg-neutral-800 rounded-xl flex items-center justify-center border-2 border-indigo-100 dark:border-neutral-700">
          <MousePointer2 size={24} className="text-indigo-600 dark:text-indigo-400" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Editor</h2>
      </div>

      <label
        htmlFor="scrollToZoom"
        className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-neutral-800 border-2 border-slate-200 dark:border-neutral-700 rounded-xl cursor-pointer"
      >
        <input
          id="scrollToZoom"
          type="checkbox"
          checked={scrollToZoom}
          onChange={(event) => setScrollToZoom(event.target.checked)}
          className="mt-1 h-4 w-4 accent-indigo-600"
        />
        <span>
          <span className="block font-bold text-slate-900 dark:text-white">
            Scroll wheel zooms the canvas
          </span>
          <span className="block text-sm text-slate-600 dark:text-neutral-400 font-medium mt-1">
            {scrollToZoom
              ? "Scrolling zooms in and out. Turn this off to scroll the canvas instead."
              : "Scrolling moves the canvas, Shift+scroll moves it sideways and Cmd/Ctrl+scroll zooms, like Excalidraw."}
          </span>
        </span>
      </label>
    </div>
  );
};
