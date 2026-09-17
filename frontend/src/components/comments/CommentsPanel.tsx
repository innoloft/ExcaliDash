import React from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { MessageSquarePlus, MessagesSquare, X } from "lucide-react";
import type { EditorCommentsState } from "../../pages/editor/useEditorComments";
import { CommentThreadCard } from "./CommentThreadCard";

type Props = {
  comments: EditorCommentsState;
};

/**
 * Right-hand drawer listing every thread on the drawing. Deliberately has no
 * backdrop: the canvas must stay usable while the list is open, since placing
 * a pin is started from here.
 */
export const CommentsPanel: React.FC<Props> = ({ comments }) => {
  if (!comments.isPanelOpen) return null;

  const { visibleThreads } = comments;

  return createPortal(
    <aside className="fixed inset-y-0 right-0 z-[80] w-full max-w-sm flex flex-col bg-white dark:bg-neutral-900 border-l-2 border-black dark:border-neutral-700 shadow-[-4px_0px_0px_0px_rgba(0,0,0,1)] dark:shadow-[-4px_0px_0px_0px_rgba(255,255,255,0.08)] animate-in slide-in-from-right duration-200">
      <div className="flex items-center justify-between p-4 border-b-2 border-black dark:border-neutral-700">
        <div className="flex items-center gap-2">
          <MessagesSquare
            size={18}
            className="text-indigo-600 dark:text-indigo-400 shrink-0"
          />
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
            Comments
          </h2>
          {comments.openThreadCount > 0 ? (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800">
              {comments.openThreadCount} open
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={comments.closePanel}
          className="p-1 rounded-lg text-neutral-400 hover:text-neutral-950 dark:hover:text-white transition-colors"
          title="Close comments"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b-2 border-black dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/50">
        <button
          type="button"
          onClick={comments.isPlacing ? comments.cancelPlacing : comments.startPlacing}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg border-2 border-black dark:border-neutral-600 transition-all duration-200 shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
            comments.isPlacing
              ? "bg-indigo-600 text-white"
              : "bg-white dark:bg-neutral-900 text-slate-700 dark:text-neutral-300",
          )}
        >
          <MessageSquarePlus size={12} strokeWidth={2.5} />
          {comments.isPlacing ? "Click the canvas…" : "Add comment"}
        </button>
        {comments.resolvedThreadCount > 0 || comments.showResolved ? (
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-500 dark:text-neutral-400">
            <input
              type="checkbox"
              checked={comments.showResolved}
              onChange={(event) => comments.setShowResolved(event.target.checked)}
              className="accent-indigo-600"
            />
            Show resolved
          </label>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {visibleThreads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-neutral-400">
            <MessagesSquare size={32} />
            <span className="text-sm font-bold">
              {comments.isLoading ? "Loading comments…" : "No comments yet"}
            </span>
            <span className="text-xs text-center font-semibold">
              Use “Add comment”, then click the spot on the drawing you want to
              talk about.
            </span>
          </div>
        ) : (
          visibleThreads.map((thread) => {
            const isActive = thread.root.id === comments.activeThreadId;
            return (
              <div
                key={thread.root.id}
                role="button"
                tabIndex={0}
                onClick={() => comments.setActiveThreadId(thread.root.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    comments.setActiveThreadId(thread.root.id);
                  }
                }}
                className={clsx(
                  "rounded-xl border-2 p-3 transition-all duration-200 cursor-pointer",
                  thread.root.resolvedAt !== null && "opacity-60",
                  isActive
                    ? "border-indigo-600 dark:border-indigo-500 bg-indigo-50/40 dark:bg-indigo-900/10 shadow-[2px_2px_0px_0px_rgba(79,70,229,1)]"
                    : "border-black dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.05)] hover:-translate-y-0.5",
                )}
              >
                <CommentThreadCard
                  thread={thread}
                  showReplyBox={isActive}
                  canResolve={comments.canResolve(thread)}
                  canDelete={comments.canDelete}
                  onReply={comments.submitReply}
                  onToggleResolved={(entry) => void comments.toggleResolved(entry)}
                  onDelete={(comment) => void comments.deleteComment(comment)}
                />
              </div>
            );
          })
        )}
      </div>
    </aside>,
    document.body,
  );
};
