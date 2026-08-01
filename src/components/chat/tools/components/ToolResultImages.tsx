import { useState } from 'react';

import { ImageLightbox } from '../../view/subcomponents/ChatMessageImages';
import type { ChatImage } from '../../types/types';

type ToolResultImagesProps = {
  images: ChatImage[];
  toolName?: string;
};

function ToolResultImage({ src, alt }: { src: string; alt: string }) {
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted px-3 py-2 text-xs text-muted-foreground">
        {alt}
      </div>
    );
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
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-64 w-auto max-w-full cursor-zoom-in object-contain"
        />
      </button>
      {expanded && <ImageLightbox src={src} alt={alt} onClose={() => setExpanded(false)} />}
    </>
  );
}

/**
 * Images a tool returned — screenshots from browser automation or computer
 * use, chart renders, anything the provider emitted as an `image` content
 * block. Rendered inline under the tool result at a readable size; a click
 * opens the same fullscreen lightbox used by user attachments.
 *
 * Sources are always inline data URLs produced by the provider adapter, so
 * unlike user attachments these need no authenticated fetch.
 */
export default function ToolResultImages({ images, toolName }: ToolResultImagesProps) {
  if (!images || images.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {images.map((image, index) => {
        const src = image.data;
        if (!src) {
          return null;
        }
        return (
          <ToolResultImage
            key={`${index}-${src.slice(0, 32)}`}
            src={src}
            alt={image.name || `${toolName || 'Tool'} image ${index + 1}`}
          />
        );
      })}
    </div>
  );
}
