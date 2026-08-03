import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, CornerUpRight } from 'lucide-react';

type LastUserMessageBarProps = {
  text: string;
  /** Shown only once the prompt itself has scrolled out of reach. */
  visible: boolean;
};

/**
 * Pins the most recent prompt to the top of the message pane.
 *
 * A long agent turn buries the question that started it, and on a phone that
 * can be many screens up. This keeps it one glance away: collapsed to a single
 * line by default, expanded on click for prompts that do not fit.
 */
export default function LastUserMessageBar({ text, visible }: LastUserMessageBarProps) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();

  // A new prompt starts collapsed, otherwise the bar stays open across turns.
  useEffect(() => {
    setExpanded(false);
  }, [trimmed]);

  if (!visible || !trimmed) {
    return null;
  }

  return (
    <div className="pointer-events-none sticky top-3 z-20 mb-2 flex justify-start px-4 sm:px-6">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse last prompt' : 'Expand last prompt'}
        className="pointer-events-auto flex max-w-[min(42rem,calc(100%-5rem))] items-start gap-2 rounded-lg border border-border/60 bg-background/85 px-3 py-2 text-left shadow-sm backdrop-blur transition-colors hover:bg-background"
      >
        <CornerUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span
          className={`text-xs leading-relaxed text-muted-foreground ${
            expanded ? 'max-h-40 overflow-y-auto whitespace-pre-wrap' : 'line-clamp-1'
          }`}
        >
          {trimmed}
        </span>
        {expanded
          ? <ChevronUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>
    </div>
  );
}
