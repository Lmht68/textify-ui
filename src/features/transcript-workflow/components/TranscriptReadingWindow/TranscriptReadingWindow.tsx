import { useEffect, useRef } from 'react';

import './TranscriptReadingWindow.css';
import { TranscriptResultReadingWindow } from './TranscriptResultReadingWindow';

import type {
  ActiveTranscriptJobState,
  TranscriptWorkflowState,
} from '../../hooks/useTranscriptWorkflow';

type TranscriptReadingWindowProps = Readonly<{
  workflowState: TranscriptWorkflowState;
  onCancelActiveTranscriptJob: () => Promise<void>;
}>;

type TranscriptJobReadingWindowProps = Readonly<{
  heading: string;
  body: string;
  cancelControl?: CancelControl;
  onCancelActiveTranscriptJob: () => Promise<void>;
}>;

type CancelControl = Readonly<{
  label: string;
  isDisabled: boolean;
  statusMessage: string | null;
}>;

export const TranscriptReadingWindow = ({
  workflowState,
  onCancelActiveTranscriptJob,
}: TranscriptReadingWindowProps) => {
  switch (workflowState.status) {
    case 'idle':
      return null;
    case 'submitting':
      return workflowState.attempt === 1 ? (
        <TranscriptJobReadingWindow
          heading="Sending Source Video"
          body="Submitting your link to Textify."
          onCancelActiveTranscriptJob={onCancelActiveTranscriptJob}
        />
      ) : (
        <TranscriptJobReadingWindow
          heading="Trying submission once more"
          body="A connection problem interrupted the first attempt. Textify will try once more."
          onCancelActiveTranscriptJob={onCancelActiveTranscriptJob}
        />
      );
    case 'queued':
    case 'processing':
      return (
        <ActiveTranscriptJobReadingWindow
          activeJob={workflowState}
          cancelControl={{
            label: 'Cancel',
            isDisabled: false,
            statusMessage: workflowState.cancellationFeedback?.message ?? null,
          }}
          onCancelActiveTranscriptJob={onCancelActiveTranscriptJob}
        />
      );
    case 'cancelling':
      return (
        <ActiveTranscriptJobReadingWindow
          activeJob={workflowState}
          cancelControl={{
            label: 'Cancellation requested',
            isDisabled: true,
            statusMessage:
              workflowState.cancellationFeedback?.message ??
              'Cancellation accepted. Textify is cleaning up this Transcript Job.',
          }}
          onCancelActiveTranscriptJob={onCancelActiveTranscriptJob}
        />
      );
    case 'confirming-replacement':
      return (
        <ActiveTranscriptJobReadingWindow
          activeJob={workflowState.activeJob}
          cancelControl={{
            label:
              workflowState.activeJob.status === 'cancelling' ? 'Cancellation requested' : 'Cancel',
            isDisabled: true,
            statusMessage:
              workflowState.activeJob.cancellationFeedback?.message ??
              'Resolve the replacement choice before cancelling this Transcript Job.',
          }}
          onCancelActiveTranscriptJob={onCancelActiveTranscriptJob}
        />
      );
    case 'cancellation-pending':
      return (
        <ActiveTranscriptJobReadingWindow
          activeJob={workflowState.activeJob}
          cancelControl={{
            label: 'Cancellation requested',
            isDisabled: true,
            statusMessage:
              workflowState.replacementSourceVideoUrl === null
                ? 'Requesting cancellation.'
                : 'Cancellation request in progress.',
          }}
          onCancelActiveTranscriptJob={onCancelActiveTranscriptJob}
        />
      );
    case 'checking-final-outcome':
      return (
        <ActiveTranscriptJobReadingWindow
          activeJob={workflowState.activeJob}
          cancelControl={{
            label: 'Checking final outcome',
            isDisabled: true,
            statusMessage:
              workflowState.activeJob.cancellationFeedback?.message ??
              'This Transcript Job finished before cancellation. Checking its final outcome.',
          }}
          onCancelActiveTranscriptJob={onCancelActiveTranscriptJob}
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
    case 'expired':
      return (
        <TerminalTranscriptJobReadingWindow
          heading="Transcript Job unavailable"
          body="This Transcript Job is no longer available. Enter another Source Video to start again."
        />
      );
  }
};

const ActiveTranscriptJobReadingWindow = ({
  activeJob,
  cancelControl,
  onCancelActiveTranscriptJob,
}: Readonly<{
  activeJob: ActiveTranscriptJobState;
  cancelControl: CancelControl;
  onCancelActiveTranscriptJob: () => Promise<void>;
}>) => {
  const { heading, body } = copyForActiveTranscriptJob(activeJob);

  return (
    <TranscriptJobReadingWindow
      heading={heading}
      body={body}
      cancelControl={cancelControl}
      onCancelActiveTranscriptJob={onCancelActiveTranscriptJob}
    />
  );
};

const TranscriptJobReadingWindow = ({
  heading,
  body,
  cancelControl,
  onCancelActiveTranscriptJob,
}: TranscriptJobReadingWindowProps) => (
  <section className="reading-window site-shell" aria-labelledby="transcript-job-reading-heading">
    <div className="reading-window__frame">
      <div className="reading-window__state">
        <div className="reading-window__heading">
          <div className="reading-window__title">
            <p>Transcript Job</p>
            <h2 id="transcript-job-reading-heading">{heading}</h2>
          </div>
          {cancelControl !== undefined && (
            <div className="command-rail">
              <div className="command-rail__action">
                <button
                  className="command-rail__button"
                  type="button"
                  aria-disabled={cancelControl.isDisabled || undefined}
                  aria-describedby="transcript-job-cancellation-status"
                  onClick={() => {
                    if (!cancelControl.isDisabled) {
                      void onCancelActiveTranscriptJob();
                    }
                  }}
                >
                  <span className="command-rail__label">{cancelControl.label}</span>
                </button>
                <output
                  className="action-status"
                  id="transcript-job-cancellation-status"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {cancelControl.statusMessage ?? ''}
                </output>
              </div>
            </div>
          )}
        </div>
        <p className="reading-window__state-copy">{body}</p>
      </div>
    </div>
  </section>
);

const TerminalTranscriptJobReadingWindow = ({ heading, body }: Readonly<{
  heading: string;
  body: string;
}>) => {
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

const copyForActiveTranscriptJob = (activeJob: ActiveTranscriptJobState): Readonly<{
  heading: string;
  body: string;
}> => {
  switch (activeJob.status) {
    case 'queued':
      return {
        heading: 'Waiting to start',
        body: 'Your Source Video was accepted and is waiting for processing. Keep this page open. Closing or refreshing it will lose access to this Transcript Job.',
      };
    case 'processing':
      return {
        heading: 'Creating transcript',
        body: 'Textify is creating a Transcript from your Source Video. Keep this page open. Closing or refreshing it will lose access to this Transcript Job.',
      };
    case 'cancelling':
      return {
        heading: 'Cancelling transcript job',
        body: 'Textify accepted the cancellation request and is cleaning up this Transcript Job. Keep this page open until cancellation finishes.',
      };
  }
};
