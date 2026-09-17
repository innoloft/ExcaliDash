import type { Server as SocketIoServer } from "socket.io";
import type { PrismaClient } from "../../generated/client";
import {
  canEditDrawing,
  isOwnerAccess,
  type DrawingAccess,
  type DrawingPrincipal,
} from "../../authz/sharing";

export const MAX_COMMENT_BODY_LENGTH = 2000;
// Scene coordinates are unbounded in principle; clamp to a range far outside
// any realistic canvas so a pin can never be stored as Infinity/NaN.
export const MAX_COMMENT_COORDINATE = 1_000_000;

// Anonymous link-share visitors have no account, and a client-supplied name
// would let them pose as a real user, so every guest is recorded as one.
export const GUEST_AUTHOR_NAME = "Guest";

export type CommentRecord = {
  id: string;
  drawingId: string;
  parentId: string | null;
  authorUserId: string | null;
  authorName: string;
  body: string;
  x: number;
  y: number;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicComment = Omit<
  CommentRecord,
  "resolvedAt" | "createdAt" | "updatedAt"
> & {
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Comment bodies are rendered as plain text by the client, never as HTML, so
 * they must not go through `sanitizeText` (DOMPurify entity-encodes `<` and
 * `&`, mangling things like `a < b && c`). Strip control characters and cap
 * the length instead, matching how canvas element text is handled.
 */
export const sanitizeCommentBody = (input: unknown): string => {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, MAX_COMMENT_BODY_LENGTH)
    .trim();
};

export const normalizeCoordinate = (input: unknown): number | null => {
  if (typeof input !== "number" || !Number.isFinite(input)) return null;
  if (Math.abs(input) > MAX_COMMENT_COORDINATE) return null;
  return input;
};

export const toPublicComment = (comment: CommentRecord): PublicComment => ({
  id: comment.id,
  drawingId: comment.drawingId,
  parentId: comment.parentId,
  authorUserId: comment.authorUserId,
  authorName: comment.authorName,
  body: comment.body,
  x: comment.x,
  y: comment.y,
  resolvedAt: comment.resolvedAt ? comment.resolvedAt.toISOString() : null,
  createdAt: comment.createdAt.toISOString(),
  updatedAt: comment.updatedAt.toISOString(),
});

export const resolveCommentAuthor = async (
  prisma: PrismaClient,
  principal: DrawingPrincipal | null,
): Promise<{ authorUserId: string | null; authorName: string }> => {
  if (principal?.kind !== "user") {
    return { authorUserId: null, authorName: GUEST_AUTHOR_NAME };
  }
  const user = await prisma.user.findUnique({
    where: { id: principal.userId },
    select: { id: true, name: true },
  });
  if (!user) return { authorUserId: null, authorName: GUEST_AUTHOR_NAME };
  const name = user.name.trim().slice(0, 120);
  return {
    authorUserId: user.id,
    authorName: name.length > 0 ? name : GUEST_AUTHOR_NAME,
  };
};

const isCommentAuthor = (
  comment: Pick<CommentRecord, "authorUserId">,
  principal: DrawingPrincipal | null,
): boolean =>
  principal?.kind === "user" &&
  comment.authorUserId !== null &&
  comment.authorUserId === principal.userId;

/**
 * A comment can be deleted by whoever wrote it or by the drawing's owner (who
 * moderates their own canvas). Guest comments have no author to match, so only
 * the owner can remove them.
 */
export const canDeleteComment = (params: {
  access: DrawingAccess;
  comment: Pick<CommentRecord, "authorUserId">;
  principal: DrawingPrincipal | null;
}): boolean =>
  isOwnerAccess(params.access) ||
  isCommentAuthor(params.comment, params.principal);

/**
 * The pin is part of what a comment says — it points at the thing being
 * discussed — so moving it follows the same rule as deleting: the author, or
 * the drawing's owner moderating their own canvas.
 */
export const canMoveComment = (params: {
  access: DrawingAccess;
  comment: Pick<CommentRecord, "authorUserId">;
  principal: DrawingPrincipal | null;
}): boolean =>
  isOwnerAccess(params.access) ||
  isCommentAuthor(params.comment, params.principal);

/**
 * Resolving closes a thread rather than destroying it, so anyone who can edit
 * the drawing may do it — plus the thread's author, who may only have view
 * access but is entitled to close their own question.
 */
export const canResolveComment = (params: {
  access: DrawingAccess;
  comment: Pick<CommentRecord, "authorUserId">;
  principal: DrawingPrincipal | null;
}): boolean =>
  canEditDrawing(params.access) ||
  isCommentAuthor(params.comment, params.principal);

/**
 * Tell everyone in the drawing's collaboration room that its comments changed.
 * The payload is deliberately just the drawing id: clients refetch the thread
 * list, which keeps ordering/permission filtering on the server.
 */
export const broadcastCommentsChanged = (
  io: SocketIoServer | undefined,
  drawingId: string,
): void => {
  io?.to(`drawing_${drawingId}`).emit("comments-changed", { drawingId });
};
