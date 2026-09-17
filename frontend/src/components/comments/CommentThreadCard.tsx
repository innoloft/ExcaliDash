import React from "react";
import clsx from "clsx";
import { Check, CornerDownRight, Trash2, Undo2 } from "lucide-react";
import type { CommentThread, DrawingComment } from "../../api";
import { CommentComposer } from "./CommentComposer";
import { formatCommentTime } from "./commentTime";

type Props = {
  thread: CommentThread;
  showReplyBox: boolean;
  canResolve: boolean;
  canDelete: (comment: DrawingComment) => boolean;
  onReply: (threadId: string, body: string) => Promise<boolean>;
  onToggleResolved: (thread: CommentThread) => void;
  onDelete: (comment: DrawingComment) => void;
};

const CommentRow: React.FC<{
  comment: DrawingComment;
  isReply?: boolean;
  canDelete: boolean;
  onDelete: (comment: DrawingComment) => void;
}> = ({ comment, isReply = false, canDelete, onDelete }) => (
  <div className={clsx("group/comment", isReply && "pl-4")}>
    <div className="flex items-start gap-1.5">
      {isReply ? (
        <CornerDownRight
          size={12}
          className="mt-1 shrink-0 text-neutral-300 dark:text-neutral-600"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100 truncate">
            {comment.authorName}
          </span>
          <span className="text-[10px] font-semibold text-neutral-400 dark:text-neutral-500 shrink-0">
            {formatCommentTime(comment.createdAt)}
          </span>
          {canDelete ? (
            <button
              type="button"
              onClick={() => onDelete(comment)}
              title={isReply ? "Delete reply" : "Delete thread"}
              className="ml-auto shrink-0 p-1 rounded text-neutral-300 hover:text-red-600 dark:text-neutral-600 dark:hover:text-red-400 opacity-0 group-hover/comment:opacity-100 focus:opacity-100 transition-opacity"
            >
              <Trash2 size={12} strokeWidth={2.5} />
            </button>
          ) : null}
        </div>
        {/* Rendered as text, never as HTML: bodies are stored verbatim. */}
        <p className="mt-0.5 text-sm font-medium text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words">
          {comment.body}
        </p>
      </div>
    </div>
  </div>
);

export const CommentThreadCard: React.FC<Props> = ({
  thread,
  showReplyBox,
  canResolve,
  canDelete,
  onReply,
  onToggleResolved,
  onDelete,
}) => {
  const isResolved = thread.root.resolvedAt !== null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        <CommentRow
          comment={thread.root}
          canDelete={canDelete(thread.root)}
          onDelete={onDelete}
        />
        {thread.replies.map((reply) => (
          <CommentRow
            key={reply.id}
            comment={reply}
            isReply
            canDelete={canDelete(reply)}
            onDelete={onDelete}
          />
        ))}
      </div>

      {canResolve ? (
        <button
          type="button"
          onClick={() => onToggleResolved(thread)}
          className={clsx(
            "self-start flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg border-2 transition-all duration-200",
            "border-black dark:border-neutral-600 bg-white dark:bg-neutral-900 text-slate-700 dark:text-neutral-300",
            "shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
          )}
        >
          {isResolved ? (
            <>
              <Undo2 size={12} strokeWidth={2.5} />
              Reopen
            </>
          ) : (
            <>
              <Check size={12} strokeWidth={2.5} />
              Resolve
            </>
          )}
        </button>
      ) : null}

      {showReplyBox && !isResolved ? (
        <CommentComposer
          placeholder="Reply…"
          submitLabel="Reply"
          onSubmit={(body) => onReply(thread.root.id, body)}
        />
      ) : null}
    </div>
  );
};
