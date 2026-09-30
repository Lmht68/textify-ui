import { useEffect, useRef, useState } from 'react';

import { copyText } from '../copyText';
import { downloadText } from '../downloadText';

import type { TranscriptResult } from '../../transcript-jobs/transport';

type TranscriptResultReadingWindowProps = Readonly<{
  result: TranscriptResult;
}>;

type ActionFeedback =
  | { status: 'idle' }
  | {
    status: 'success' | 'error';
    action: 'copy' | 'download';
    message: string;
  };

type DisplayLanguage = Readonly<{
  name: string;
  lang: string | undefined;
}>;

const PLATFORM_NAMES: Record<TranscriptResult['source']['platform'], string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  x: 'X',
};

export const TranscriptResultReadingWindow = ({ result }: TranscriptResultReadingWindowProps) => {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>({ status: 'idle' });
  const platformName = PLATFORM_NAMES[result.source.platform];
  const title = result.source.title.trim() || `${platformName} video`;
  const channel = result.source.channel.trim();
  const language = displayLanguage(result.transcript.language);
  const hasTranscript = result.transcript.text.length > 0;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const handleCopy = async (): Promise<void> => {
    if (!hasTranscript) {
      return;
    }

    try {
      await copyText(result.transcript.text);
      setActionFeedback({
        status: 'success',
        action: 'copy',
        message: 'Transcript copied.',
      });
    } catch {
      setActionFeedback({
        status: 'error',
        action: 'copy',
        message: "Couldn't copy the Transcript. Try again.",
      });
    }
  };

  const handleDownload = (): void => {
    if (!hasTranscript) {
      return;
    }

    try {
      downloadText({
        filename: 'textify-transcript.txt',
        text: `${result.transcript.text}\n`,
      });
      setActionFeedback({
        status: 'success',
        action: 'download',
        message: 'Transcript downloaded.',
      });
    } catch {
      setActionFeedback({
        status: 'error',
        action: 'download',
        message: "Couldn't download the Transcript. Try again.",
      });
    }
  };

  return (
    <section className="reading-window site-shell" aria-labelledby="transcript-result-heading">
      <div className="reading-window__frame">
        <div className="reading-window__heading">
          <div className="reading-window__title">
            <p>Transcript result</p>
            <h2 id="transcript-result-heading" ref={headingRef} tabIndex={-1}>
              {title}
            </h2>
          </div>
          <div className="command-rail" aria-label="Transcript result actions">
            <div className="command-rail__utilities">
              <div className="command-rail__action">
                <a
                  className="command-rail__button"
                  href={result.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="command-rail__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M14 5h5v5" />
                      <path d="m19 5-8.5 8.5" />
                      <path d="M19 14v4.5A1.5 1.5 0 0 1 17.5 20h-12A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5H10" />
                    </svg>
                  </span>
                  <span className="command-rail__label">Open source</span>
                </a>
              </div>
              <div className="command-rail__action">
                <button
                  className="command-rail__button"
                  type="button"
                  disabled={!hasTranscript}
                  aria-describedby={hasTranscript ? undefined : 'transcript-empty-state'}
                  onClick={() => {
                    void handleCopy();
                  }}
                >
                  <span className="command-rail__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="8" y="8" width="10" height="10" />
                      <path d="M16 8V5.5H5.5V16H8" />
                    </svg>
                  </span>
                  <span className="command-rail__label">Copy</span>
                </button>
                <output
                  className={actionFeedback.status === 'error' ? 'action-status action-status--error' : 'action-status'}
                  role="status"
                  aria-label="Copy feedback"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {actionFeedback.status !== 'idle' && actionFeedback.action === 'copy' ? actionFeedback.message : ''}
                </output>
              </div>
              <div className="command-rail__action">
                <button
                  className="command-rail__button"
                  type="button"
                  disabled={!hasTranscript}
                  aria-describedby={hasTranscript ? undefined : 'transcript-empty-state'}
                  onClick={handleDownload}
                >
                  <span className="command-rail__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 4v10" />
                      <path d="m8 10 4 4 4-4" />
                      <path d="M5 18v2h14v-2" />
                    </svg>
                  </span>
                  <span className="command-rail__label">Download</span>
                </button>
                <output
                  className={actionFeedback.status === 'error' ? 'action-status action-status--error' : 'action-status'}
                  role="status"
                  aria-label="Download feedback"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {actionFeedback.status !== 'idle' && actionFeedback.action === 'download'
                    ? actionFeedback.message
                    : ''}
                </output>
              </div>
            </div>
          </div>
        </div>
        <dl className="source-metadata">
          <div>
            <dt>Supported Platform</dt>
            <dd>{platformName}</dd>
          </div>
          {channel === '' ? null : (
            <div>
              <dt>Channel</dt>
              <dd>{channel}</dd>
            </div>
          )}
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(result.source.durationSeconds)}</dd>
          </div>
          <div>
            <dt>Detected language</dt>
            <dd>{language.name}</dd>
          </div>
        </dl>
        <article className="transcript" aria-labelledby="transcript-result-heading">
          {hasTranscript ? (
            <p lang={language.lang} dir="auto">
              {result.transcript.text}
            </p>
          ) : (
            <p className="transcript__empty-state" id="transcript-empty-state">
              No spoken text was detected in this Source Video.
            </p>
          )}
        </article>
      </div>
    </section>
  );
};

const formatDuration = (durationSeconds: number): string => {
  if (durationSeconds < 60) {
    return `${durationSeconds} sec`;
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;

  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} sec`;
};

const displayLanguage = (value: string): DisplayLanguage => {
  const language = value.trim();

  if (language === '') {
    return { name: 'Unknown', lang: undefined };
  }

  try {
    const canonicalLanguage = Intl.getCanonicalLocales(language)[0];

    if (canonicalLanguage === undefined || canonicalLanguage.toLowerCase() === 'und') {
      return { name: 'Unknown', lang: undefined };
    }

    try {
      return {
        name: new Intl.DisplayNames(['en'], { type: 'language' }).of(canonicalLanguage) ?? canonicalLanguage,
        lang: canonicalLanguage,
      };
    } catch {
      return { name: canonicalLanguage, lang: canonicalLanguage };
    }
  } catch {
    return { name: 'Unknown', lang: undefined };
  }
};
