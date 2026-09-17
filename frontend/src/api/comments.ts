import { api } from "./client";

export interface DrawingComment {
  id: string;
  drawingId: string;
  /** Null for a thread's first comment; otherwise that comment's id. */
  parentId: string | null;
  authorUserId: string | null;
  authorName: string;
  body: string;
  /** Scene coordinates of the pin (0 on replies, which reuse the root's pin). */
  x: number;
  y: number;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommentThread {
  root: DrawingComment;
  replies: DrawingComment[];
}

export const getDrawingComments = async (
  drawingId: string,
): Promise<DrawingComment[]> => {
  const response = await api.get<{ comments: DrawingComment[] }>(
    `/drawings/${drawingId}/comments`,
  );
  return Array.isArray(response.data?.comments) ? response.data.comments : [];
};

export const createDrawingComment = async (
  drawingId: string,
  input: { body: string; x: number; y: number },
): Promise<DrawingComment> => {
  const response = await api.post<DrawingComment>(
    `/drawings/${drawingId}/comments`,
    input,
  );
  return response.data;
};

export const replyToDrawingComment = async (
  drawingId: string,
  parentId: string,
  body: string,
): Promise<DrawingComment> => {
  const response = await api.post<DrawingComment>(
    `/drawings/${drawingId}/comments`,
    { body, parentId },
  );
  return response.data;
};

export const setDrawingCommentResolved = async (
  drawingId: string,
  commentId: string,
  resolved: boolean,
): Promise<DrawingComment> => {
  const response = await api.patch<DrawingComment>(
    `/drawings/${drawingId}/comments/${commentId}`,
    { resolved },
  );
  return response.data;
};

export const deleteDrawingComment = async (
  drawingId: string,
  commentId: string,
): Promise<void> => {
  await api.delete(`/drawings/${drawingId}/comments/${commentId}`);
};

/**
 * Group a flat comment list into threads. Replies whose root is missing (a
 * thread deleted between fetches) are dropped rather than rendered orphaned.
 */
export const groupCommentThreads = (
  comments: DrawingComment[],
): CommentThread[] => {
  const threads = new Map<string, CommentThread>();
  for (const comment of comments) {
    if (comment.parentId === null) {
      threads.set(comment.id, { root: comment, replies: [] });
    }
  }
  for (const comment of comments) {
    if (comment.parentId === null) continue;
    threads.get(comment.parentId)?.replies.push(comment);
  }
  return [...threads.values()];
};
