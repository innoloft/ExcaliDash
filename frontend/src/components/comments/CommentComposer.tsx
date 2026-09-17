import React, { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Loader2, Send } from "lucide-react";

export const MAX_COMMENT_LENGTH = 2000;

type Props = {
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
};

/**
 * Shared text box for writing a new thread or a reply. Ctrl/Cmd+Enter posts,
 * Escape hands control back to the caller (which closes the popover).
 */
export const CommentComposer: React.FC<Props> = ({
  placeholder,
  submitLabel,
  autoFocus = false,
  onSubmit,
  onCancel,
}) => {
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const submit = async () => {
    const trimmed = body.trim();
    if (trimmed.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    const posted = await onSubmit(trimmed);
    setIsSubmitting(false);
    if (posted) setBody("");
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        value={body}
        maxLength={MAX_COMMENT_LENGTH}
        rows={3}
        placeholder={placeholder}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel?.();
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        className="w-full resize-none rounded-lg border-2 border-black dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2.5 py-2 text-sm font-medium text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 outline-none focus:border-indigo-600 dark:focus:border-indigo-500"
      />
      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-[11px] font-bold rounded-lg border-2 border-black dark:border-neutral-600 bg-white dark:bg-neutral-900 text-slate-700 dark:text-neutral-300 shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] transition-all duration-200 hover:-translate-y-0.5 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={body.trim().length === 0 || isSubmitting}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg border-2 border-black transition-all duration-200",
            "bg-indigo-600 text-white shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "enabled:hover:-translate-y-0.5 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
          )}
        >
          {isSubmitting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Send size={12} strokeWidth={2.5} />
          )}
          {submitLabel}
        </button>
      </div>
    </div>
  );
};
