import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { useEditorComments } from "./useEditorComments";

// Only the network calls are faked; the real grouping helper stays in play so
// the thread shapes under test are the ones the app actually renders.
vi.mock("../../api", async () => {
  const comments = await vi.importActual<typeof import("../../api/comments")>(
    "../../api/comments",
  );
  return {
    getDrawingComments: vi.fn(),
    createDrawingComment: vi.fn(),
    replyToDrawingComment: vi.fn(),
    setDrawingCommentResolved: vi.fn(),
    deleteDrawingComment: vi.fn(),
    groupCommentThreads: comments.groupCommentThreads,
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const makeComment = (
  id: string,
  overrides: Partial<api.DrawingComment> = {},
): api.DrawingComment => ({
  id,
  drawingId: "drawing-1",
  parentId: null,
  authorUserId: "user-1",
  authorName: "Test User",
  body: `body ${id}`,
  x: 0,
  y: 0,
  resolvedAt: null,
  createdAt: "2026-09-17T10:00:00.000Z",
  updatedAt: "2026-09-17T10:00:00.000Z",
  ...overrides,
});

const renderComments = (
  accessLevel: "none" | "view" | "edit" | "owner" = "edit",
  currentUserId: string | null = "user-1",
) =>
  renderHook(() =>
    useEditorComments({
      drawingId: "drawing-1",
      accessLevel,
      currentUserId,
      excalidrawAPI: { current: null },
    }),
  );

describe("useEditorComments", () => {
  const getComments = vi.mocked(api.getDrawingComments);
  const createComment = vi.mocked(api.createDrawingComment);

  beforeEach(() => {
    getComments.mockResolvedValue([]);
  });

  it("does not fetch comments without access to the drawing", async () => {
    renderComments("none");
    await waitFor(() => expect(getComments).not.toHaveBeenCalled());
  });

  it("groups replies under their thread and counts only open threads", async () => {
    getComments.mockResolvedValue([
      makeComment("root-1"),
      makeComment("reply-1", { parentId: "root-1" }),
      makeComment("root-2", { resolvedAt: "2026-09-17T11:00:00.000Z" }),
    ]);

    const { result } = renderComments();

    await waitFor(() => expect(result.current.threads).toHaveLength(2));
    expect(result.current.threads[0].replies.map((r) => r.id)).toEqual([
      "reply-1",
    ]);
    expect(result.current.openThreadCount).toBe(1);
    // Resolved threads are hidden until explicitly shown.
    expect(result.current.visibleThreads.map((t) => t.root.id)).toEqual([
      "root-1",
    ]);

    act(() => result.current.setShowResolved(true));
    await waitFor(() => expect(result.current.visibleThreads).toHaveLength(2));
  });

  it("posts the pin position picked on the canvas", async () => {
    const created = makeComment("root-new", { x: 42, y: -7 });
    createComment.mockResolvedValue(created);

    const { result } = renderComments();
    await waitFor(() => expect(getComments).toHaveBeenCalled());

    act(() => result.current.startPlacing());
    expect(result.current.isPlacing).toBe(true);

    act(() => result.current.placeDraftAt({ x: 42, y: -7 }));
    expect(result.current.isPlacing).toBe(false);
    expect(result.current.draftPoint).toEqual({ x: 42, y: -7 });

    await act(async () => {
      await result.current.submitDraft("  looks off  ");
    });

    expect(createComment).toHaveBeenCalledWith("drawing-1", {
      body: "looks off",
      x: 42,
      y: -7,
    });
    expect(result.current.draftPoint).toBeNull();
    expect(result.current.activeThreadId).toBe("root-new");
    expect(result.current.threads).toHaveLength(1);
  });

  it("lets the author delete their own comment but not a stranger's", async () => {
    getComments.mockResolvedValue([
      makeComment("mine"),
      makeComment("theirs", { authorUserId: "user-2", authorName: "Other" }),
    ]);

    const { result } = renderComments("view");
    await waitFor(() => expect(result.current.threads).toHaveLength(2));

    const [mine, theirs] = result.current.threads;
    expect(result.current.canDelete(mine.root)).toBe(true);
    expect(result.current.canDelete(theirs.root)).toBe(false);
    // A view-only user may still close their own thread.
    expect(result.current.canResolve(mine)).toBe(true);
    expect(result.current.canResolve(theirs)).toBe(false);
  });

  it("lets the drawing owner moderate every thread", async () => {
    getComments.mockResolvedValue([
      makeComment("theirs", { authorUserId: "user-2", authorName: "Other" }),
    ]);

    const { result } = renderComments("owner");
    await waitFor(() => expect(result.current.threads).toHaveLength(1));
    expect(result.current.canDelete(result.current.threads[0].root)).toBe(true);
  });
});
