import { useCallback, useEffect, useRef, useState } from 'react';

import { inspectTranscriptJob, submitSourceVideo } from '../transcript-jobs/transport';
import type {
  SubmitSourceVideoResult,
  TranscriptJobCapability,
  TranscriptJobErrorCode,
  TranscriptResult,
} from '../transcript-jobs/transport';

const SUBMISSION_TIMEOUT_MILLISECONDS = 10_000;
const MINIMUM_RETRY_DELAY_MILLISECONDS = 500;
const RETRY_DELAY_RANGE_MILLISECONDS = 501;

export type SubmissionFeedback = Readonly<{
  message: string;
  politeness: 'assertive' | 'polite';
  isInvalid: boolean;
}>;

export type TranscriptWorkflowFailure =
  | Readonly<{ kind: 'job'; code: TranscriptJobErrorCode }>
  | Readonly<{ kind: 'backend'; code: TranscriptJobErrorCode }>
  | Readonly<{ kind: 'network' }>
  | Readonly<{ kind: 'contract' }>;

export type TranscriptWorkflowState =
  | Readonly<{ status: 'sample'; feedback: SubmissionFeedback | null }>
  | Readonly<{ status: 'submitting'; attempt: 1 | 2 }>
  | Readonly<{
    status: 'queued';
    capability: TranscriptJobCapability;
    retryAfterMilliseconds: number;
  }>
  | Readonly<{
    status: 'processing';
    capability: TranscriptJobCapability;
    retryAfterMilliseconds: number;
  }>
  | Readonly<{ status: 'succeeded'; result: TranscriptResult }>
  | Readonly<{ status: 'failed'; failure: TranscriptWorkflowFailure }>
  | Readonly<{ status: 'cancelled' }>;

export type UseTranscriptWorkflowResult = Readonly<{
  sourceVideoUrl: string;
  workflowState: TranscriptWorkflowState;
  setSourceVideoUrl: (value: string) => void;
  submitSourceVideoUrl: () => Promise<void>;
}>;

type AttemptResult = Readonly<{
  result: SubmitSourceVideoResult;
  timedOut: boolean;
}>;

type PendingRetry = Readonly<{
  timeoutId: number;
  resolve: () => void;
}>;

const EMPTY_URL_FEEDBACK: SubmissionFeedback = {
  message: 'Enter a Source Video URL.',
  politeness: 'assertive',
  isInvalid: true,
};

const INVALID_URL_FEEDBACK: SubmissionFeedback = {
  message: 'Enter a complete HTTPS Source Video URL.',
  politeness: 'assertive',
  isInvalid: true,
};

const GENERIC_SUBMISSION_FEEDBACK: SubmissionFeedback = {
  message: 'Textify could not submit this Source Video. Try again.',
  politeness: 'polite',
  isInvalid: false,
};

const AMBIGUOUS_SUBMISSION_FEEDBACK: SubmissionFeedback = {
  message:
    'Textify could not confirm whether a previous attempt was accepted. Trying again may create another Transcript Job.',
  politeness: 'polite',
  isInvalid: false,
};

export const useTranscriptWorkflow = (): UseTranscriptWorkflowResult => {
  const [sourceVideoUrl, setSourceVideoUrlValue] = useState('');
  const [workflowState, setWorkflowState] = useState<TranscriptWorkflowState>({
    status: 'sample',
    feedback: null,
  });
  const activeRequestRef = useRef<AbortController | null>(null);
  const pendingRetryRef = useRef<PendingRetry | null>(null);
  const isMountedRef = useRef(true);
  const isSubmissionLockedRef = useRef(false);
  const submissionVersionRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      submissionVersionRef.current += 1;
      activeRequestRef.current?.abort();

      const pendingRetry = pendingRetryRef.current;

      if (pendingRetry !== null) {
        window.clearTimeout(pendingRetry.timeoutId);
        pendingRetryRef.current = null;
        pendingRetry.resolve();
      }
    };
  }, []);

  useEffect(() => {
    if (workflowState.status !== 'queued' && workflowState.status !== 'processing') {
      return;
    }

    let ownsPollingEffect = true;
    let controller: AbortController | null = null;
    const { capability, retryAfterMilliseconds } = workflowState;

    const poll = async (): Promise<void> => {
      if (!ownsPollingEffect || !isMountedRef.current) {
        return;
      }

      controller = new AbortController();
      const result = await inspectTranscriptJob({ capability, signal: controller.signal });

      if (!ownsPollingEffect || !isMountedRef.current) {
        return;
      }

      switch (result.kind) {
        case 'queued':
        case 'processing':
          setWorkflowState({
            status: result.kind,
            capability: result.capability,
            retryAfterMilliseconds: result.retryAfterMilliseconds,
          });
          return;
        case 'succeeded':
          setWorkflowState({ status: 'succeeded', result: result.result });
          return;
        case 'failed':
          setWorkflowState({ status: 'failed', failure: { kind: 'job', code: result.code } });
          return;
        case 'cancelled':
          setWorkflowState({ status: 'cancelled' });
          return;
        case 'backend-error':
          setWorkflowState({ status: 'failed', failure: { kind: 'backend', code: result.code } });
          return;
        case 'network-error':
          setWorkflowState({ status: 'failed', failure: { kind: 'network' } });
          return;
        case 'contract-error':
          setWorkflowState({ status: 'failed', failure: { kind: 'contract' } });
          return;
        case 'aborted':
          return;
      }
    };

    const timeoutId = window.setTimeout(() => {
      void poll();
    }, retryAfterMilliseconds);

    return () => {
      ownsPollingEffect = false;
      window.clearTimeout(timeoutId);
      controller?.abort();
    };
  }, [workflowState]);

  const setSourceVideoUrl = useCallback((value: string): void => {
    setSourceVideoUrlValue(value);
    setWorkflowState((currentState) =>
      currentState.status === 'sample' && currentState.feedback !== null
        ? { status: 'sample', feedback: null }
        : currentState,
    );
  }, []);

  const submitSourceVideoUrl = useCallback(async (): Promise<void> => {
    if (isSubmissionLockedRef.current) {
      return;
    }

    const trimmedSourceVideoUrl = sourceVideoUrl.trim();
    const validationFeedback = validateSourceVideoUrl(trimmedSourceVideoUrl);

    if (validationFeedback !== null) {
      setWorkflowState({ status: 'sample', feedback: validationFeedback });
      return;
    }

    setSourceVideoUrlValue(trimmedSourceVideoUrl);
    isSubmissionLockedRef.current = true;
    const submissionVersion = submissionVersionRef.current + 1;
    submissionVersionRef.current = submissionVersion;
    setWorkflowState({ status: 'submitting', attempt: 1 });

    const isCurrentSubmission = (): boolean =>
      isMountedRef.current && submissionVersionRef.current === submissionVersion;
    const returnToSample = (feedback: SubmissionFeedback): void => {
      if (!isCurrentSubmission()) {
        return;
      }

      isSubmissionLockedRef.current = false;
      setWorkflowState({ status: 'sample', feedback });
    };
    const submitAttempt = async (): Promise<AttemptResult> => {
      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, SUBMISSION_TIMEOUT_MILLISECONDS);
      activeRequestRef.current = controller;

      try {
        return {
          result: await submitSourceVideo({ sourceVideoUrl: trimmedSourceVideoUrl, signal: controller.signal }),
          timedOut,
        };
      } finally {
        window.clearTimeout(timeoutId);

        if (activeRequestRef.current === controller) {
          activeRequestRef.current = null;
        }
      }
    };
    const firstAttempt = await submitAttempt();

    if (!isCurrentSubmission()) {
      return;
    }

    if (firstAttempt.result.kind === 'accepted') {
      setWorkflowState({
        status: 'queued',
        capability: firstAttempt.result.capability,
        retryAfterMilliseconds: firstAttempt.result.retryAfterMilliseconds,
      });
      return;
    }

    if (firstAttempt.result.kind === 'backend-error') {
      returnToSample(feedbackForBackendError(firstAttempt.result.code));
      return;
    }

    if (firstAttempt.result.kind === 'contract-error') {
      returnToSample(GENERIC_SUBMISSION_FEEDBACK);
      return;
    }

    if (firstAttempt.result.kind === 'aborted' && !firstAttempt.timedOut) {
      return;
    }

    setWorkflowState({ status: 'submitting', attempt: 2 });
    await waitForRetry(pendingRetryRef, retryDelayMilliseconds());

    if (!isCurrentSubmission()) {
      return;
    }

    const secondAttempt = await submitAttempt();

    if (!isCurrentSubmission()) {
      return;
    }

    if (secondAttempt.result.kind === 'accepted') {
      setWorkflowState({
        status: 'queued',
        capability: secondAttempt.result.capability,
        retryAfterMilliseconds: secondAttempt.result.retryAfterMilliseconds,
      });
      return;
    }

    if (secondAttempt.result.kind === 'backend-error') {
      returnToSample(feedbackForBackendError(secondAttempt.result.code));
      return;
    }

    if (secondAttempt.result.kind === 'contract-error') {
      returnToSample(GENERIC_SUBMISSION_FEEDBACK);
      return;
    }

    if (secondAttempt.result.kind === 'aborted' && !secondAttempt.timedOut) {
      return;
    }

    returnToSample(AMBIGUOUS_SUBMISSION_FEEDBACK);
  }, [sourceVideoUrl]);

  return {
    sourceVideoUrl,
    workflowState,
    setSourceVideoUrl,
    submitSourceVideoUrl,
  };
};

const validateSourceVideoUrl = (sourceVideoUrl: string): SubmissionFeedback | null => {
  if (sourceVideoUrl === '') {
    return EMPTY_URL_FEEDBACK;
  }

  try {
    const parsedUrl = new URL(sourceVideoUrl);

    return parsedUrl.protocol === 'https:' && parsedUrl.hostname !== '' ? null : INVALID_URL_FEEDBACK;
  } catch {
    return INVALID_URL_FEEDBACK;
  }
};

const feedbackForBackendError = (code: TranscriptJobErrorCode): SubmissionFeedback => {
  switch (code) {
    case 'invalid_url':
    case 'invalid_request':
      return {
        message: 'Check the Source Video URL and try again.',
        politeness: 'polite',
        isInvalid: true,
      };
    case 'unsupported_platform':
      return {
        message: 'Use a public video link from YouTube, TikTok, Instagram, Facebook, or X.',
        politeness: 'polite',
        isInvalid: true,
      };
    case 'transcription_capacity_exceeded':
    case 'job_store_unavailable':
      return {
        message: 'Textify is busy right now. Try again later.',
        politeness: 'polite',
        isInvalid: false,
      };
    case 'audio_download_failed':
    case 'audio_download_timeout':
    case 'internal_error':
    case 'invalid_media_duration':
    case 'job_already_finished':
    case 'job_not_found':
    case 'metadata_retrieval_failed':
    case 'metadata_timeout':
    case 'no_usable_transcript':
    case 'queue_timeout':
    case 'transcription_failed':
    case 'transcription_timeout':
    case 'unsupported_content':
    case 'unsupported_media':
    case 'video_too_long':
    case 'worker_interrupted':
      return GENERIC_SUBMISSION_FEEDBACK;
  }
};

const retryDelayMilliseconds = (): number =>
  MINIMUM_RETRY_DELAY_MILLISECONDS + Math.floor(Math.random() * RETRY_DELAY_RANGE_MILLISECONDS);

const waitForRetry = (pendingRetryRef: { current: PendingRetry | null }, milliseconds: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  const timeoutId = window.setTimeout(() => {
    pendingRetryRef.current = null;
    resolve();
  }, milliseconds);

  pendingRetryRef.current = { timeoutId, resolve };

  return promise;
};
