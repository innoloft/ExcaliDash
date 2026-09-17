import express from "express";
import { canViewDrawing, getDrawingAccess } from "../../authz/sharing";
import type { DrawingRouteContext } from "./drawingRouteContext";
import {
  broadcastCommentsChanged,
  canDeleteComment,
  canMoveComment,
  canResolveComment,
  normalizeCoordinate,
  resolveCommentAuthor,
  sanitizeCommentBody,
  toPublicComment,
} from "./drawingCommentHelpers";

const MAX_COMMENTS_PER_DRAWING = 1000;

export const registerDrawingCommentRoutes = (
  app: express.Express,
  context: DrawingRouteContext,
) => {
  const {
    prisma,
    optionalAuth,
    asyncHandler,
    getRequestPrincipal,
    respondWithAuthErrorIfPresent,
    io,
  } = context;

  // Comments follow the drawing's own access policy: everyone who can open the
  // drawing (including share-link viewers) can read and post, which is what
  // makes them useful for review. Moderation is narrower — see the helpers.
  const requireViewAccess = async (
    req: express.Request,
    res: express.Response,
  ) => {
    const principal = await getRequestPrincipal(req);
    const access = await getDrawingAccess({
      prisma,
      principal,
      drawingId: req.params.id,
    });
    if (!canViewDrawing(access)) {
      if (respondWithAuthErrorIfPresent(req, res)) return null;
      res.status(404).json({
        error: "Drawing not found",
        message: "Drawing does not exist",
      });
      return null;
    }
    return { principal, access };
  };

  app.get(
    "/drawings/:id/comments",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const granted = await requireViewAccess(req, res);
      if (!granted) return;

      const comments = await prisma.drawingComment.findMany({
        where: { drawingId: req.params.id },
        orderBy: { createdAt: "asc" },
        take: MAX_COMMENTS_PER_DRAWING,
      });

      return res.json({ comments: comments.map(toPublicComment) });
    }),
  );

  app.post(
    "/drawings/:id/comments",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const granted = await requireViewAccess(req, res);
      if (!granted) return;

      const drawingId = req.params.id;
      const body = sanitizeCommentBody(req.body?.body);
      if (body.length === 0) {
        return res.status(400).json({
          error: "Validation error",
          message: "Comment text is required",
        });
      }

      const rawParentId = req.body?.parentId;
      if (rawParentId !== undefined && rawParentId !== null && typeof rawParentId !== "string") {
        return res.status(400).json({
          error: "Validation error",
          message: "parentId must be a string",
        });
      }
      const parentId = typeof rawParentId === "string" ? rawParentId : null;

      let x = 0;
      let y = 0;
      if (parentId) {
        // A reply must attach to a root comment on this same drawing; nesting
        // deeper would produce threads the pin UI cannot render.
        const parent = await prisma.drawingComment.findFirst({
          where: { id: parentId, drawingId },
          select: { id: true, parentId: true },
        });
        if (!parent || parent.parentId !== null) {
          return res.status(404).json({
            error: "Comment not found",
            message: "Cannot reply to this comment",
          });
        }
      } else {
        const parsedX = normalizeCoordinate(req.body?.x);
        const parsedY = normalizeCoordinate(req.body?.y);
        if (parsedX === null || parsedY === null) {
          return res.status(400).json({
            error: "Validation error",
            message: "A comment pin needs finite x and y scene coordinates",
          });
        }
        x = parsedX;
        y = parsedY;
      }

      const existingCount = await prisma.drawingComment.count({
        where: { drawingId },
      });
      if (existingCount >= MAX_COMMENTS_PER_DRAWING) {
        return res.status(429).json({
          error: "Too many comments",
          message: "This drawing has reached its comment limit",
        });
      }

      const author = await resolveCommentAuthor(prisma, granted.principal);
      const comment = await prisma.drawingComment.create({
        data: {
          drawingId,
          parentId,
          authorUserId: author.authorUserId,
          authorName: author.authorName,
          body,
          x,
          y,
        },
      });

      broadcastCommentsChanged(io, drawingId);
      return res.status(201).json(toPublicComment(comment));
    }),
  );

  app.patch(
    "/drawings/:id/comments/:commentId",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const granted = await requireViewAccess(req, res);
      if (!granted) return;

      const { id: drawingId, commentId } = req.params;
      const comment = await prisma.drawingComment.findFirst({
        where: { id: commentId, drawingId },
      });
      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }
      if (comment.parentId !== null) {
        return res.status(400).json({
          error: "Validation error",
          message:
            "Only a thread's first comment carries the pin and resolved state",
        });
      }

      // Resolving and moving are independent edits with their own permission
      // rules, so a request may carry either or both.
      const resolved = req.body?.resolved;
      const wantsResolve = resolved !== undefined;
      const wantsMove = req.body?.x !== undefined || req.body?.y !== undefined;

      if (!wantsResolve && !wantsMove) {
        return res.status(400).json({
          error: "Validation error",
          message: "Nothing to update",
        });
      }
      if (wantsResolve && typeof resolved !== "boolean") {
        return res.status(400).json({
          error: "Validation error",
          message: "resolved must be a boolean",
        });
      }

      let position: { x: number; y: number } | null = null;
      if (wantsMove) {
        // Both coordinates travel together: a half-move would silently keep the
        // pin's old axis and land it somewhere nobody picked.
        const x = normalizeCoordinate(req.body?.x);
        const y = normalizeCoordinate(req.body?.y);
        if (x === null || y === null) {
          return res.status(400).json({
            error: "Validation error",
            message: "Moving a comment pin needs finite x and y scene coordinates",
          });
        }
        position = { x, y };
      }

      if (
        wantsResolve &&
        !canResolveComment({
          access: granted.access,
          comment,
          principal: granted.principal,
        })
      ) {
        return res.status(403).json({
          error: "Forbidden",
          message: "You cannot resolve this comment",
        });
      }
      if (
        position &&
        !canMoveComment({
          access: granted.access,
          comment,
          principal: granted.principal,
        })
      ) {
        return res.status(403).json({
          error: "Forbidden",
          message: "You cannot move this comment",
        });
      }

      const updated = await prisma.drawingComment.update({
        where: { id: commentId },
        data: {
          ...(wantsResolve
            ? {
                resolvedAt: resolved ? new Date() : null,
                resolvedByUserId: resolved
                  ? granted.principal?.kind === "user"
                    ? granted.principal.userId
                    : null
                  : null,
              }
            : {}),
          ...(position ?? {}),
        },
      });

      broadcastCommentsChanged(io, drawingId);
      return res.json(toPublicComment(updated));
    }),
  );

  app.delete(
    "/drawings/:id/comments/:commentId",
    optionalAuth,
    asyncHandler(async (req, res) => {
      const granted = await requireViewAccess(req, res);
      if (!granted) return;

      const { id: drawingId, commentId } = req.params;
      const comment = await prisma.drawingComment.findFirst({
        where: { id: commentId, drawingId },
      });
      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }
      if (
        !canDeleteComment({
          access: granted.access,
          comment,
          principal: granted.principal,
        })
      ) {
        return res.status(403).json({
          error: "Forbidden",
          message: "You cannot delete this comment",
        });
      }

      // Replies cascade with the root row, so deleting a thread starter
      // removes the whole thread.
      await prisma.drawingComment.delete({ where: { id: commentId } });

      broadcastCommentsChanged(io, drawingId);
      return res.status(204).send();
    }),
  );
};
