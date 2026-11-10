import { ReaderIcon } from '@radix-ui/react-icons';
import { useState } from 'react';

export type CoverSize = 'sm' | 'md' | 'lg';

/**
 * A book's cover, or a plain book on a coloured tile when there is none or it will not load. The
 * title is always written next to it, so the picture carries no words of its own. Only https
 * addresses are tried: the site's content security policy allows covers from Hardcover and nowhere else.
 */
export default function Cover({ url, size = 'md' }: { url: string | null | undefined; size?: CoverSize }) {
  // The address that failed, so a different book in the same place gets a fresh try.
  const [failed, setFailed] = useState<string | null>(null);
  const src = url?.startsWith('https://') && url !== failed ? url : null;
  return (
    <div className={`cover cover-${size}`} aria-hidden="true">
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          // Hardcover does not need to know which site its covers are shown on.
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
        />
      ) : (
        <ReaderIcon className="cover-placeholder" />
      )}
    </div>
  );
}
