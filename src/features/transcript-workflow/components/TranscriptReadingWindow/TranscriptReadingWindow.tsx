import { useEffect, useRef } from 'react';

import './TranscriptReadingWindow.css';
import { TranscriptResultReadingWindow } from './TranscriptResultReadingWindow';

import type { TranscriptWorkflowState } from '../../hooks/useTranscriptWorkflow';

type TranscriptReadingWindowProps = Readonly<{
  workflowState: TranscriptWorkflowState;
}>;

type TranscriptJobReadingWindowProps = Readonly<{
  heading: string;
  body: string;
}>;


export const TranscriptReadingWindow = ({ workflowState }: TranscriptReadingWindowProps) => {
  switch (workflowState.status) {
    case 'idle':
      return null;
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
