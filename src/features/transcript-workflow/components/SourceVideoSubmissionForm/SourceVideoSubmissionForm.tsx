import { useEffect, useRef } from 'react';
import type { FormEvent, KeyboardEvent, RefObject } from 'react';

import './SourceVideoSubmissionForm.css';

import type { SubmissionFeedback, TranscriptWorkflowState } from '../../hooks/useTranscriptWorkflow';

type SourceVideoSubmissionFormProps = Readonly<{
  inputRef: RefObject<HTMLInputElement | null>;
  submitButtonRef: RefObject<HTMLButtonElement | null>;
  sourceVideoUrl: string;
  feedback: SubmissionFeedback | null;
  workflowState: TranscriptWorkflowState;
  isSubmissionLocked: boolean;
  onSourceVideoUrlChange: (value: string) => void;
  onSubmitSourceVideo: () => Promise<void>;
  onConfirmReplacement: () => Promise<void>;
  onDeclineReplacement: () => void;
}>;

type ReplacementConfirmation = Readonly<{
  heading: string;
  body: string;
  declineLabel: string;
  confirmLabel: string;
  feedback: SubmissionFeedback | null;
  isPending: boolean;
}>;

export const SourceVideoSubmissionForm = ({
  inputRef,
  submitButtonRef,
  sourceVideoUrl,
  feedback,
  workflowState,
  isSubmissionLocked,
  onSourceVideoUrlChange,
  onSubmitSourceVideo,
  onConfirmReplacement,
  onDeclineReplacement,
}: SourceVideoSubmissionFormProps) => {
  const declineButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmation = replacementConfirmationFor(workflowState);
  const isInputReadOnly =
    workflowState.status === 'submitting' ||
    workflowState.status === 'confirming-replacement' ||
    workflowState.status === 'cancellation-pending';

  useEffect(() => {
    if (feedback?.politeness === 'assertive') {
      inputRef.current?.focus();
    }
  }, [feedback, inputRef]);

  useEffect(() => {
    if (workflowState.status === 'confirming-replacement') {
      declineButtonRef.current?.focus();
    }
  }, [workflowState.status]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (isSubmissionLocked || confirmation?.isPending === true) {
      return;
    }

    void onSubmitSourceVideo();
  };
  const handleConfirmationKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (confirmation?.isPending === true && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
    }
  };
  const handleDecline = (): void => {
    if (confirmation?.isPending === true) {
      return;
    }

    onDeclineReplacement();
    submitButtonRef.current?.focus();
  };
  const handleConfirm = (): void => {
    if (confirmation?.isPending === true) {
      return;
    }

    void onConfirmReplacement();
  };

  return (
    <form className="submission-rail" noValidate onSubmit={handleSubmit}>
      <div className="submission-rail__field">
        <label className="submission-rail__label" htmlFor="source-video-url">
          Source Video URL
        </label>
        <input
          id="source-video-url"
          ref={inputRef}
          name="sourceVideoUrl"
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          value={sourceVideoUrl}
          readOnly={isInputReadOnly}
          aria-invalid={feedback?.isInvalid || undefined}
          aria-describedby="source-video-url-hint source-video-url-feedback"
          onChange={(event) => {
            onSourceVideoUrlChange(event.target.value);
          }}
        />
        <p className="submission-rail__hint" id="source-video-url-hint">
          Paste one public HTTPS video link. Source Videos can be up to 30 minutes.
        </p>
        <output
          className="submission-rail__feedback"
          id="source-video-url-feedback"
          role={feedback?.politeness === 'assertive' ? 'alert' : 'status'}
          aria-live={feedback?.politeness ?? 'polite'}
          aria-atomic="true"
        >
          {feedback?.message ?? ''}
        </output>
      </div>
      <button
        className="submission-rail__submit"
        ref={submitButtonRef}
        type="submit"
        aria-disabled={isSubmissionLocked || undefined}
      >
        Get transcript
      </button>
      {confirmation !== undefined && (
        <section className="submission-rail__confirmation" aria-labelledby="replacement-confirmation-heading">
          <div>
            <h2 id="replacement-confirmation-heading">{confirmation.heading}</h2>
            <p>{confirmation.body}</p>
            {confirmation.feedback !== null && (
              <output
                className="submission-rail__confirmation-feedback"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {confirmation.feedback.message}
              </output>
            )}
          </div>
          <div className="submission-rail__confirmation-actions">
            <button
              className="submission-rail__confirmation-action"
              ref={declineButtonRef}
              type="button"
              aria-disabled={confirmation.isPending || undefined}
              onClick={handleDecline}
              onKeyDown={handleConfirmationKeyDown}
            >
              {confirmation.declineLabel}
            </button>
            <button
              className="submission-rail__confirmation-action"
              type="button"
              aria-disabled={confirmation.isPending || undefined}
              aria-describedby={
                confirmation.isPending ? 'replacement-cancellation-pending-status' : undefined
              }
              onClick={handleConfirm}
              onKeyDown={handleConfirmationKeyDown}
            >
              {confirmation.confirmLabel}
            </button>
            <output
              className="submission-rail__confirmation-status"
              id="replacement-cancellation-pending-status"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {confirmation.isPending
                ? 'Requesting cancellation before starting the new Source Video.'
                : ''}
            </output>
          </div>
        </section>
      )}
    </form>
  );
};

const replacementConfirmationFor = (
  workflowState: TranscriptWorkflowState,
): ReplacementConfirmation | undefined => {
  switch (workflowState.status) {
    case 'confirming-replacement':
      return workflowState.activeJob.status === 'cancelling'
        ? {
          heading: 'Start a new Transcript Job?',
          body: 'Textify is still cleaning up the cancelled Transcript Job. Starting another Source Video will stop this page from checking that cleanup.',
          declineLabel: 'Keep checking',
          confirmLabel: 'Start new transcript',
          feedback: workflowState.feedback,
          isPending: false,
        }
        : {
          heading: 'Replace this Transcript Job?',
          body: 'Textify will cancel the current Transcript Job before submitting the new Source Video.',
          declineLabel: 'Keep current job',
          confirmLabel: 'Cancel and replace',
          feedback: workflowState.feedback,
          isPending: false,
        };
    case 'cancellation-pending':
      return workflowState.replacementSourceVideoUrl === null
        ? undefined
        : {
          heading: 'Replace this Transcript Job?',
          body: 'Textify will cancel the current Transcript Job before submitting the new Source Video.',
          declineLabel: 'Keep current job',
          confirmLabel: 'Cancel and replace',
          feedback: null,
          isPending: true,
        };
    case 'idle':
    case 'submitting':
    case 'queued':
    case 'processing':
    case 'cancelling':
    case 'checking-final-outcome':
    case 'succeeded':
    case 'failed':
    case 'cancelled':
    case 'expired':
      return undefined;
  }
};
