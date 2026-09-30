import { useEffect, useRef, useState } from 'react';

import { TranscriptResultReadingWindow } from './TranscriptResultReadingWindow';
import { copyText } from '../copyText';
import { DEMO_TRANSCRIPT } from '../demoTranscript';
import { downloadText } from '../downloadText';

import type { TranscriptWorkflowState } from '../../transcript-workflow/useTranscriptWorkflow';

type TranscriptReadingWindowProps = Readonly<{
  workflowState: TranscriptWorkflowState;
}>;

type TranscriptJobReadingWindowProps = Readonly<{
  heading: string;
  body: string;
}>;

type ActionFeedback =
  | { status: 'idle' }
  | {
    status: 'success' | 'error';
    action: 'copy' | 'download';
    message: string;
  };


const SampleTranscriptReadingWindow = () => {
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>({ status: 'idle' });

  const handleCopy = async () => {
    try {
      await copyText(DEMO_TRANSCRIPT.exportText);
      setActionFeedback({
        status: 'success',
        action: 'copy',
        message: 'Demo transcript copied.',
      });
    } catch {
      setActionFeedback({
        status: 'error',
        action: 'copy',
        message: "Couldn't copy the demo transcript. Try again.",
      });
    }
  };

  const handleDownload = () => {
    try {
      downloadText({
        filename: DEMO_TRANSCRIPT.filename,
        text: DEMO_TRANSCRIPT.exportText,
      });
      setActionFeedback({
        status: 'success',
        action: 'download',
        message: 'Demo transcript downloaded.',
      });
    } catch {
      setActionFeedback({
        status: 'error',
        action: 'download',
        message: "Couldn't download the demo transcript. Try again.",
      });
    }
  };

  return (
    <section className="reading-window site-shell" aria-labelledby="demo-reading-heading">
      <div className="reading-window__frame">
        <div className="reading-window__heading">
          <div className="reading-window__title">
            <p>{DEMO_TRANSCRIPT.label}</p>
            <h2 id="demo-reading-heading">{DEMO_TRANSCRIPT.title}</h2>
          </div>
          <div className="command-rail" aria-label="Demo transcript actions">
            <div className="command-rail__utilities">
              <div className="command-rail__action">
                <button
                  className="command-rail__button"
                  type="button"
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
                  {actionFeedback.status !== 'idle' && actionFeedback.action === 'copy'
                    ? actionFeedback.message
                    : ''}
                </output>
              </div>
              <div className="command-rail__action">
                <button className="command-rail__button" type="button" onClick={handleDownload}>
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
        <article className="transcript" aria-labelledby="demo-reading-heading">
          {DEMO_TRANSCRIPT.paragraphs.map((paragraph) => (
            <p key={paragraph} dir="auto">
              {paragraph}
            </p>
          ))}
        </article>
      </div>
    </section>
  );
};

export const TranscriptReadingWindow = ({ workflowState }: TranscriptReadingWindowProps) => {
  switch (workflowState.status) {
    case 'sample':
      return <SampleTranscriptReadingWindow />;
    case 'submitting':
      return workflowState.attempt === 1 ? (
        <TranscriptJobReadingWindow heading="Sending Source Video" body="Submitting your link to Textify." />
      ) : (
        <TranscriptJobReadingWindow
          heading="Trying submission once more"
          body="A connection problem interrupted the first attempt. Textify will try once more."
        />
      );
    case 'queued':
      return (
        <TranscriptJobReadingWindow
          heading="Waiting to start"
          body="Your Source Video was accepted and is waiting for processing. Keep this page open. Closing or refreshing it will lose access to this Transcript Job."
        />
      );
    case 'processing':
      return (
        <TranscriptJobReadingWindow
          heading="Creating transcript"
          body="Textify is creating a Transcript from your Source Video. Keep this page open. Closing or refreshing it will lose access to this Transcript Job."
        />
      );
    case 'succeeded':
      return <TranscriptResultReadingWindow result={workflowState.result} />;
    case 'failed':
      return (
        <TerminalTranscriptJobReadingWindow
          heading="Transcript unavailable"
          body="Textify couldn't provide this Transcript."
        />
      );
    case 'cancelled':
      return (
        <TerminalTranscriptJobReadingWindow
          heading="Transcript Job cancelled"
          body="This Transcript Job ended without creating a Transcript."
        />
      );
  }
};

const TranscriptJobReadingWindow = ({ heading, body }: TranscriptJobReadingWindowProps) => (
  <section className="reading-window site-shell" aria-labelledby="transcript-job-reading-heading">
    <div className="reading-window__frame">
      <div className="reading-window__state" role="status" aria-live="polite" aria-atomic="true">
        <div className="reading-window__heading">
          <div className="reading-window__title">
            <p>Transcript Job</p>
            <h2 id="transcript-job-reading-heading">{heading}</h2>
          </div>
        </div>
        <p className="reading-window__state-copy">{body}</p>
      </div>
    </div>
  </section>
);

const TerminalTranscriptJobReadingWindow = ({ heading, body }: TranscriptJobReadingWindowProps) => {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section className="reading-window site-shell" aria-labelledby="transcript-job-reading-heading">
      <div className="reading-window__frame">
        <div className="reading-window__state">
          <div className="reading-window__heading">
            <div className="reading-window__title">
              <p>Transcript Job</p>
              <h2 id="transcript-job-reading-heading" ref={headingRef} tabIndex={-1}>
                {heading}
              </h2>
            </div>
          </div>
          <p className="reading-window__state-copy">{body}</p>
        </div>
      </div>
    </section>
  );
};
