import React, { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { MessageSquare, X } from "lucide-react";
import type { EditorCommentsState } from "../../pages/editor/useEditorComments";
import {
  canvasPointToScene,
  sceneToCanvasPoint,
  type Point,
} from "../../utils/canvasCoords";
import { CommentComposer } from "./CommentComposer";
import { CommentThreadCard } from "./CommentThreadCard";

const POPOVER_WIDTH = 288; // matches w-72
const POPOVER_MAX_HEIGHT = 280;
const PIN_OFFSET = 14;
// Below this many pixels a pointer press is a click that opens the thread, not
// a drag: pins are small, and a hand rarely presses one perfectly still.
const DRAG_THRESHOLD_PX = 3;

type DragState = {
  threadId: string;
  pointerId: number;
  /** Where the press started, in client pixels. */
  originClient: Point;
  /** The pin's scene position when the press started. */
  originScene: Point;
  /** Live scene position while dragging, or the origin before the threshold. */
  scene: Point;
  /** False for a pin this user may read but not re-anchor. */
  movable: boolean;
  moved: boolean;
};

type Props = {
  comments: EditorCommentsState;
};

/**
 * Canvas layer that draws a marker for every open thread at its scene position
 * and hosts the popover for the active thread or the pin being placed. Pins can
 * be dragged to re-anchor their thread. The layer only swallows pointer events
 * while the user is placing a pin — otherwise clicks fall through to Excalidraw
 * as usual.
 */
export const CommentsOverlay: React.FC<Props> = ({ comments }) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);

  const {
    activeThreadId,
    canComment,
    cancelPlacing,
    draftPoint,
    isPlacing,
    placeDraftAt,
    setActiveThreadId,
    viewport,
    visibleThreads,
  } = comments;

  // The overlay only mounts once the drawing's access level is known, so the
  // size has to be (re)measured whenever the element appears or the window
  // changes — not just on the first render.
  useEffect(() => {
    const element = overlayRef.current;
    if (!element) return;
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [canComment]);

  useEffect(() => {
    if (!isPlacing && !draftPoint && !activeThreadId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isPlacing || draftPoint) cancelPlacing();
      else setActiveThreadId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Depends on the individual callbacks (stable) rather than the state
    // object, which is a fresh literal on every pan/zoom frame.
  }, [activeThreadId, cancelPlacing, draftPoint, isPlacing, setActiveThreadId]);

  const handlePlacementClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const element = overlayRef.current;
      if (!isPlacing || !element) return;
      const rect = element.getBoundingClientRect();
      placeDraftAt(
        canvasPointToScene(
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          viewport,
        ),
      );
    },
    [isPlacing, placeDraftAt, viewport],
  );

  // Every press on a pin goes through the drag handlers: one that stays put
  // opens the thread, one that travels moves the pin.
  const startDrag = useCallback(
    (
      event: React.PointerEvent<HTMLButtonElement>,
      pin: { id: string; x: number; y: number },
      movable: boolean,
    ) => {
      if (event.button !== 0 || isPlacing) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        threadId: pin.id,
        pointerId: event.pointerId,
        originClient: { x: event.clientX, y: event.clientY },
        originScene: { x: pin.x, y: pin.y },
        scene: { x: pin.x, y: pin.y },
        movable,
        moved: false,
      });
    },
    [isPlacing],
  );

  const continueDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      setDrag((current) => {
        if (!current || current.pointerId !== event.pointerId) return current;
        if (!current.movable) return current;
        const dx = event.clientX - current.originClient.x;
        const dy = event.clientY - current.originClient.y;
        if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
          return current;
        }
        return {
          ...current,
          moved: true,
          // Client-pixel deltas convert to scene units by zoom alone, so a drag
          // tracks the cursor exactly at any zoom level.
          scene: {
            x: current.originScene.x + dx / viewport.zoom,
            y: current.originScene.y + dy / viewport.zoom,
          },
        };
      });
    },
    [viewport.zoom],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, threadId: string) => {
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const finished = drag?.pointerId === event.pointerId ? drag : null;
      setDrag(null);
      if (!finished) return;
      if (finished.moved) {
        void comments.moveThread(finished.threadId, finished.scene);
        return;
      }
      // A press that never crossed the threshold is a click on the pin.
      setActiveThreadId(activeThreadId === threadId ? null : threadId);
    },
    [activeThreadId, comments, drag, setActiveThreadId],
  );

  if (!canComment) return null;

  // Keep a popover inside the canvas instead of letting it hang off the edge.
  const popoverStyle = (anchor: { x: number; y: number }) => {
    const flipLeft =
      size.width > 0 && anchor.x + PIN_OFFSET + POPOVER_WIDTH > size.width;
    return {
      left: flipLeft
        ? Math.max(8, anchor.x - PIN_OFFSET - POPOVER_WIDTH)
        : anchor.x + PIN_OFFSET,
      top: Math.max(
        8,
        Math.min(anchor.y + PIN_OFFSET, Math.max(8, size.height - POPOVER_MAX_HEIGHT)),
      ),
    };
  };

  const activeThread =
    visibleThreads.find((thread) => thread.root.id === activeThreadId) ?? null;

  // A pin being dragged follows the pointer; the stored position only catches
  // up once the move has been saved.
  const pinScene = (pin: { id: string; x: number; y: number }): Point =>
    drag?.threadId === pin.id && drag.moved ? drag.scene : { x: pin.x, y: pin.y };

  return (
    <div
      ref={overlayRef}
      onClick={handlePlacementClick}
      className={clsx(
        "absolute inset-0 z-[6]",
        isPlacing ? "pointer-events-auto cursor-crosshair" : "pointer-events-none",
      )}
    >
      {isPlacing ? (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-lg border-2 border-black dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-1.5 text-xs font-bold text-neutral-800 dark:text-neutral-200 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          Click anywhere to place your comment · Esc to cancel
        </div>
      ) : null}

      {visibleThreads.map((thread) => {
        const point = sceneToCanvasPoint(pinScene(thread.root), viewport);
        const isActive = thread.root.id === activeThreadId;
        const isResolved = thread.root.resolvedAt !== null;
        const movable = comments.canMove(thread.root);
        const isDragging = drag?.threadId === thread.root.id && drag.moved;
        return (
          <button
            key={thread.root.id}
            type="button"
            style={{ left: point.x, top: point.y }}
            onPointerDown={(event) => startDrag(event, thread.root, movable)}
            onPointerMove={continueDrag}
            onPointerUp={(event) => endDrag(event, thread.root.id)}
            onPointerCancel={() => setDrag(null)}
            onClick={(event) => event.stopPropagation()}
            title={`${thread.root.authorName}: ${thread.root.body.slice(0, 80)}${
              movable ? " · drag to move" : ""
            }`}
            className={clsx(
              "pointer-events-auto absolute flex h-7 min-w-7 -translate-y-full touch-none items-center gap-1 rounded-full rounded-bl-none border-2 border-black px-1.5 text-[11px] font-bold shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]",
              // No transition while dragging: the pin has to sit under the
              // cursor, not ease towards it.
              isDragging
                ? "cursor-grabbing"
                : clsx(
                    "transition-transform duration-150 hover:-translate-y-[calc(100%+2px)]",
                    movable ? "cursor-grab" : "cursor-pointer",
                  ),
              isResolved
                ? "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
                : isActive
                  ? "bg-indigo-600 text-white"
                  : "bg-amber-300 text-neutral-900",
            )}
          >
            <MessageSquare size={12} strokeWidth={2.5} />
            {thread.replies.length > 0 ? thread.replies.length + 1 : null}
          </button>
        );
      })}

      {activeThread && !(drag?.moved ?? false) ? (
        <div
          onClick={(event) => event.stopPropagation()}
          style={popoverStyle(
            sceneToCanvasPoint(pinScene(activeThread.root), viewport),
          )}
          className="pointer-events-auto absolute z-[7] w-72 max-h-[60vh] overflow-y-auto rounded-xl border-2 border-black dark:border-neutral-600 bg-white dark:bg-neutral-900 p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
        >
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => setActiveThreadId(null)}
              className="p-1 rounded text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
          <CommentThreadCard
            thread={activeThread}
            showReplyBox
            canResolve={comments.canResolve(activeThread)}
            canDelete={comments.canDelete}
            onReply={comments.submitReply}
            onToggleResolved={(thread) => void comments.toggleResolved(thread)}
            onDelete={(comment) => void comments.deleteComment(comment)}
          />
        </div>
      ) : null}

      {draftPoint ? (
        <div
          onClick={(event) => event.stopPropagation()}
          style={popoverStyle(sceneToCanvasPoint(draftPoint, viewport))}
          className="pointer-events-auto absolute z-[7] w-72 rounded-xl border-2 border-black dark:border-neutral-600 bg-white dark:bg-neutral-900 p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
        >
          <CommentComposer
            autoFocus
            placeholder="Add a comment…"
            submitLabel="Comment"
            onSubmit={comments.submitDraft}
            onCancel={cancelPlacing}
          />
        </div>
      ) : null}
    </div>
  );
};
