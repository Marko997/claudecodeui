import { useEffect, useRef, useState } from 'react';

import { ImageLightbox, useChatImageSrc } from '../../view/subcomponents/ChatMessageImages';
import type { ChatImage } from '../../types/types';

type ToolResultImagesProps = {
  images: ChatImage[];
  toolName?: string;
  projectId?: string | null;
};

/**
 * Reports whether the element has come near the viewport. Used to hold back
 * image fetches until they are about to be seen — a long session can hold
 * dozens of screenshots, and pulling them all on load is what made the chat
 * crawl over a mobile link.
 */
function useNearViewport<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || isNear) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setIsNear(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNear(true);
          observer.disconnect();
        }
      },
      // Start a little early so the image is usually there by the time the
      // row is actually on screen.
      { rootMargin: '300px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [isNear]);

  return { ref, isNear };
}

/** Renders one image once it is worth fetching. Mounting starts the request. */
function ToolResultImageBody({ image, alt, projectId }: { image: ChatImage; alt: string; projectId?: string | null }) {
  const { src, failed } = useChatImageSrc(image, projectId);
  const [expanded, setExpanded] = useState(false);
  const [brokenSrc, setBrokenSrc] = useState(false);

  if (failed || brokenSrc) {
    return (
      <div className="flex h-24 items-center rounded-lg border border-border/50 bg-muted px-3 text-xs text-muted-foreground">
        {alt}
      </div>
    );
  }

  if (!src) {
    return <div className="h-24 w-40 animate-pulse rounded-lg border border-border/50 bg-muted" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`Expand ${alt}`}
        className="block overflow-hidden rounded-lg border border-border/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
      >
        <img
          src={src}
          alt={alt}
          onError={() => setBrokenSrc(true)}
          className="max-h-64 w-auto max-w-full cursor-zoom-in object-contain"
        />
      </button>
      {expanded && <ImageLightbox src={src} alt={alt} onClose={() => setExpanded(false)} />}
    </>
  );
}

function ToolResultImage({ image, alt, projectId }: { image: ChatImage; alt: string; projectId?: string | null }) {
  const { ref, isNear } = useNearViewport<HTMLDivElement>();

  return (
    <div ref={ref}>
      {isNear
        ? <ToolResultImageBody image={image} alt={alt} projectId={projectId} />
        : <div className="h-24 w-40 rounded-lg border border-border/50 bg-muted/50" />}
    </div>
  );
}

/**
 * Images a tool returned — screenshots from browser automation or computer
 * use, chart renders, anything the provider emitted as an `image` content
 * block. Rendered inline under the tool result at a readable size; a click
 * opens the same fullscreen lightbox used by user attachments.
 *
 * The backend caches these into the asset store and sends a path rather than
 * the bytes, so each image costs one small request and only when it is
 * actually scrolled into view.
 */
export default function ToolResultImages({ images, toolName, projectId }: ToolResultImagesProps) {
  if (!images || images.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {images.map((image, index) => (
        <ToolResultImage
          key={image.path || image.data || index}
          image={image}
          alt={image.name || `${toolName || 'Tool'} image ${index + 1}`}
          projectId={projectId}
        />
      ))}
    </div>
  );
}
