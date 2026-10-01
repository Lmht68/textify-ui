import { useEffect, useRef, useState } from 'react';

import { TranscriptResultViewer } from './TranscriptResultViewer';
import { copyText } from '../../services/copyText';
import { downloadText } from '../../services/downloadText';
import {
  buildTranscriptDownloadFilename,
  buildTranscriptExportText,
} from '../../utils/transcriptResultView';

import type { TranscriptView } from '../../utils/transcriptResultView';
import type { TranscriptResult } from '../../services/transcriptJobs';

type TranscriptResultReadingWindowProps = Readonly<{
  result: TranscriptResult;
}>;

type ActionFeedback =
  | { status: 'idle' }
  | {
    status: 'success' | 'error';
    action: 'copy' | 'download';
    view: TranscriptView;
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
  const [activeView, setActiveView] = useState<TranscriptView>('plain');
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>({ status: 'idle' });
  const platformName = PLATFORM_NAMES[result.source.platform];
  const title = result.source.title.trim() || `${platformName} video`;
  const channel = result.source.channel.trim();
  const language = displayLanguage(result.transcript.language);
  const exportText = buildTranscriptExportText({ transcript: result.transcript, view: activeView });
  const filename = buildTranscriptDownloadFilename({
    platformName,
    title: result.source.title,
    view: activeView,
  });
  const hasExportableContent =
    activeView === 'plain' ? result.transcript.text.length > 0 : result.transcript.segments.length > 0;
  const activeViewName = activeView === 'plain' ? 'Plain text' : 'Timestamps';
  const activeViewDescription = activeView === 'plain' ? 'plain text' : 'timestamps';
  const copyFeedback =
    actionFeedback.status !== 'idle' && actionFeedback.action === 'copy' && actionFeedback.view === activeView
      ? actionFeedback.message
      : '';
  const downloadFeedback =
    actionFeedback.status !== 'idle' && actionFeedback.action === 'download' && actionFeedback.view === activeView
      ? actionFeedback.message
      : '';

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const handleActiveViewChange = (view: TranscriptView): void => {
    if (view === activeView) {
      return;
    }

    setActiveView(view);
    setActionFeedback({ status: 'idle' });
  };

  const handleCopy = async (): Promise<void> => {
    if (!hasExportableContent) {
      return;
    }

    try {
      await copyText(exportText);
      setActionFeedback({
        status: 'success',
        action: 'copy',
        view: activeView,
        message: `${activeViewName} copied.`,
      });
    } catch {
      setActionFeedback({
        status: 'error',
        action: 'copy',
        view: activeView,
        message: `Couldn't copy the ${activeViewDescription}. Try again.`,
      });
    }
  };

  const handleDownload = (): void => {
    if (!hasExportableContent) {
      return;
    }

    try {
      downloadText({ filename, text: exportText });
      setActionFeedback({
        status: 'success',
        action: 'download',
        view: activeView,
        message: `${activeViewName} downloaded.`,
      });
    } catch {
      setActionFeedback({
        status: 'error',
        action: 'download',
        view: activeView,
        message: `Couldn't download the ${activeViewDescription}. Try again.`,
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
                  disabled={!hasExportableContent}
                  aria-describedby={
                    hasExportableContent
                      ? copyFeedback === ''
                        ? undefined
                        : 'transcript-copy-feedback'
                      : 'transcript-empty-state'
                  }
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
                <div
                  className={
                    actionFeedback.status === 'error' && copyFeedback !== ''
                      ? 'action-status action-status--error'
                      : 'action-status'
                  }
                  id="transcript-copy-feedback"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {copyFeedback}
                </div>
              </div>
              <div className="command-rail__action">
                <button
                  className="command-rail__button"
                  type="button"
                  disabled={!hasExportableContent}
                  aria-describedby={
                    hasExportableContent
                      ? downloadFeedback === ''
                        ? undefined
                        : 'transcript-download-feedback'
                      : 'transcript-empty-state'
                  }
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
                <div
                  className={
                    actionFeedback.status === 'error' && downloadFeedback !== ''
                      ? 'action-status action-status--error'
                      : 'action-status'
                  }
                  id="transcript-download-feedback"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {downloadFeedback}
                </div>
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
        <TranscriptResultViewer
          activeView={activeView}
          canonicalSourceUrl={result.source.url}
          languageTag={language.lang}
          onActiveViewChange={handleActiveViewChange}
          platform={result.source.platform}
          transcript={result.transcript}
        />
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
