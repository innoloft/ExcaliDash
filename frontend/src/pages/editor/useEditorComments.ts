import { useCallback, useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import { toast } from "sonner";
import * as api from "../../api";
import type { CanvasViewport, Point } from "../../utils/canvasCoords";
import { useCanvasViewport } from "./useCanvasViewport";

type AccessLevel = "none" | "view" | "edit" | "owner";

type UseEditorCommentsInput = {
  drawingId?: string;
  accessLevel: AccessLevel;
  currentUserId: string | null;
  excalidrawAPI: MutableRefObject<any>;
};

export type EditorCommentsState = {
  threads: api.CommentThread[];
  visibleThreads: api.CommentThread[];
  openThreadCount: number;
  resolvedThreadCount: number;
  isLoading: boolean;
  isPanelOpen: boolean;
  isPlacing: boolean;
  showResolved: boolean;
  /** Scene position of the pin being written, before it is posted. */
  draftPoint: Point | null;
  activeThreadId: string | null;
  canComment: boolean;
  viewport: CanvasViewport;
  refresh: () => void;
  openPanel: () => void;
  closePanel: () => void;
  startPlacing: () => void;
  cancelPlacing: () => void;
  placeDraftAt: (scenePoint: Point) => void;
  submitDraft: (body: string) => Promise<boolean>;
  submitReply: (threadId: string, body: string) => Promise<boolean>;
  toggleResolved: (thread: api.CommentThread) => Promise<void>;
  deleteComment: (comment: api.DrawingComment) => Promise<void>;
  setActiveThreadId: (threadId: string | null) => void;
  setShowResolved: (show: boolean) => void;
  canDelete: (comment: api.DrawingComment) => boolean;
  canResolve: (thread: api.CommentThread) => boolean;
};

const isSameAuthor = (
  comment: api.DrawingComment,
  currentUserId: string | null,
): boolean =>
  currentUserId !== null &&
  comment.authorUserId !== null &&
  comment.authorUserId === currentUserId;

export const useEditorComments = ({
  drawingId,
  accessLevel,
  currentUserId,
  excalidrawAPI,
}: UseEditorCommentsInput): EditorCommentsState => {
  const canComment = accessLevel !== "none";
  const canEdit = accessLevel === "edit" || accessLevel === "owner";
  const isOwner = accessLevel === "owner";

  const [comments, setComments] = useState<api.DrawingComment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [draftPoint, setDraftPoint] = useState<Point | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  // The overlay only needs live scroll/zoom tracking while it has something
  // to draw or a pin to place.
  const viewport = useCanvasViewport(
    excalidrawAPI,
    canComment && (comments.length > 0 || isPlacing || draftPoint !== null),
  );

  const refresh = useCallback(() => {
    if (!drawingId || !canComment) return;
    setIsLoading(true);
    void api
      .getDrawingComments(drawingId)
      .then(setComments)
      .catch(() => {
        // A failed refresh leaves the last known threads on screen; the next
        // successful poll or socket event reconciles them.
      })
      .finally(() => setIsLoading(false));
  }, [canComment, drawingId]);

  useEffect(() => {
    setComments([]);
    setActiveThreadId(null);
    setDraftPoint(null);
    setIsPlacing(false);
    refresh();
  }, [drawingId, refresh]);

  const threads = useMemo(
    () =>
      api
        .groupCommentThreads(comments)
        .sort((a, b) => a.root.createdAt.localeCompare(b.root.createdAt)),
    [comments],
  );
  const visibleThreads = useMemo(
    () =>
      showResolved
        ? threads
        : threads.filter((thread) => thread.root.resolvedAt === null),
    [showResolved, threads],
  );
  const resolvedThreadCount = threads.length - visibleThreads.length;

  const cancelPlacing = useCallback(() => {
    setIsPlacing(false);
    setDraftPoint(null);
  }, []);

  const startPlacing = useCallback(() => {
    setActiveThreadId(null);
    setDraftPoint(null);
    setIsPlacing(true);
  }, []);

  const placeDraftAt = useCallback((scenePoint: Point) => {
    setDraftPoint(scenePoint);
    setIsPlacing(false);
  }, []);

  const submitDraft = useCallback(
    async (body: string): Promise<boolean> => {
      if (!drawingId || !draftPoint || body.trim().length === 0) return false;
      try {
        const created = await api.createDrawingComment(drawingId, {
          body: body.trim(),
          x: draftPoint.x,
          y: draftPoint.y,
        });
        setComments((previous) => [...previous, created]);
        setDraftPoint(null);
        setActiveThreadId(created.id);
        return true;
      } catch {
        toast.error("Could not post your comment");
        return false;
      }
    },
    [draftPoint, drawingId],
  );

  const submitReply = useCallback(
    async (threadId: string, body: string): Promise<boolean> => {
      if (!drawingId || body.trim().length === 0) return false;
      try {
        const created = await api.replyToDrawingComment(
          drawingId,
          threadId,
          body.trim(),
        );
        setComments((previous) => [...previous, created]);
        return true;
      } catch {
        toast.error("Could not post your reply");
        return false;
      }
    },
    [drawingId],
  );

  const toggleResolved = useCallback(
    async (thread: api.CommentThread) => {
      if (!drawingId) return;
      const resolved = thread.root.resolvedAt === null;
      try {
        const updated = await api.setDrawingCommentResolved(
          drawingId,
          thread.root.id,
          resolved,
        );
        setComments((previous) =>
          previous.map((comment) =>
            comment.id === updated.id ? updated : comment,
          ),
        );
        if (resolved) setActiveThreadId(null);
      } catch {
        toast.error("Could not update this thread");
      }
    },
    [drawingId],
  );

  const deleteComment = useCallback(
    async (comment: api.DrawingComment) => {
      if (!drawingId) return;
      try {
        await api.deleteDrawingComment(drawingId, comment.id);
        setComments((previous) =>
          previous.filter(
            (entry) => entry.id !== comment.id && entry.parentId !== comment.id,
          ),
        );
        if (comment.parentId === null && activeThreadId === comment.id) {
          setActiveThreadId(null);
        }
      } catch {
        toast.error("Could not delete this comment");
      }
    },
    [activeThreadId, drawingId],
  );

  const canDelete = useCallback(
    (comment: api.DrawingComment) =>
      isOwner || isSameAuthor(comment, currentUserId),
    [currentUserId, isOwner],
  );

  const canResolve = useCallback(
    (thread: api.CommentThread) =>
      canEdit || isSameAuthor(thread.root, currentUserId),
    [canEdit, currentUserId],
  );

  return {
    threads,
    visibleThreads,
    openThreadCount: threads.filter((thread) => thread.root.resolvedAt === null)
      .length,
    resolvedThreadCount,
    isLoading,
    isPanelOpen,
    isPlacing,
    showResolved,
    draftPoint,
    activeThreadId,
    canComment,
    viewport,
    refresh,
    openPanel: useCallback(() => setIsPanelOpen(true), []),
    closePanel: useCallback(() => setIsPanelOpen(false), []),
    startPlacing,
    cancelPlacing,
    placeDraftAt,
    submitDraft,
    submitReply,
    toggleResolved,
    deleteComment,
    setActiveThreadId,
    setShowResolved,
    canDelete,
    canResolve,
  };
};
