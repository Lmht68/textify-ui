import { useCallback, useEffect, useRef, useState } from 'react';

import { cancelTranscriptJob, inspectTranscriptJob, submitSourceVideo } from '../services/transcriptJobs';
import type {
  InspectTranscriptJobResult,
  SubmitSourceVideoResult,
  TranscriptJobCapability,
  TranscriptJobErrorCode,
  TranscriptResult,
} from '../services/transcriptJobs';

const SUBMISSION_TIMEOUT_MILLISECONDS = 10_000;
const MINIMUM_RETRY_DELAY_MILLISECONDS = 500;
const RETRY_DELAY_RANGE_MILLISECONDS = 501;

export type SubmissionFeedback = Readonly<{
  message: string;
  politeness: 'assertive' | 'polite';
  isInvalid: boolean;
}>;

export type InlineCancellationFeedback = Readonly<{
  message: string;
}>;

export type TranscriptWorkflowFailure =
  | Readonly<{ kind: 'job'; code: TranscriptJobErrorCode }>
  | Readonly<{ kind: 'backend'; code: TranscriptJobErrorCode }>
  | Readonly<{ kind: 'network' }>
  | Readonly<{ kind: 'contract' }>;

export type QueuedOrProcessingTranscriptJobState =
  | Readonly<{
    status: 'queued';
    capability: TranscriptJobCapability;
    retryAfterMilliseconds: number;
    cancellationFeedback: InlineCancellationFeedback | null;
  }>
  | Readonly<{
    status: 'processing';
    capability: TranscriptJobCapability;
    retryAfterMilliseconds: number;
    cancellationFeedback: InlineCancellationFeedback | null;
  }>;

export type CancellingTranscriptJobState = Readonly<{
  status: 'cancelling';
  capability: TranscriptJobCapability;
  retryAfterMilliseconds: number;
  cancellationFeedback: InlineCancellationFeedback | null;
}>;

export type ActiveTranscriptJobState =
  | QueuedOrProcessingTranscriptJobState
  | CancellingTranscriptJobState;

export type TranscriptWorkflowState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'submitting'; attempt: 1 | 2 }>
  | QueuedOrProcessingTranscriptJobState
  | CancellingTranscriptJobState
  | Readonly<{
    status: 'confirming-replacement';
    activeJob: ActiveTranscriptJobState;
    replacementSourceVideoUrl: string;
    feedback: SubmissionFeedback | null;
  }>
  | Readonly<{
    status: 'cancellation-pending';
    activeJob: QueuedOrProcessingTranscriptJobState;
    replacementSourceVideoUrl: string | null;
  }>
  | Readonly<{
    status: 'checking-final-outcome';
    activeJob: QueuedOrProcessingTranscriptJobState;
  }>
  | Readonly<{ status: 'succeeded'; result: TranscriptResult }>
  | Readonly<{ status: 'failed'; failure: TranscriptWorkflowFailure }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'expired' }>;

export type UseTranscriptWorkflowResult = Readonly<{
  sourceVideoUrl: string;
  workflowState: TranscriptWorkflowState;
  submissionFeedback: SubmissionFeedback | null;
  isSourceVideoSubmissionLocked: boolean;
  setSourceVideoUrl: (value: string) => void;
  submitSourceVideoUrl: () => Promise<void>;
  cancelActiveTranscriptJob: () => Promise<void>;
  confirmReplacement: () => Promise<void>;
  declineReplacement: () => void;
}>;

type AttemptResult = Readonly<{
  result: SubmitSourceVideoResult;
  timedOut: boolean;
}>;

type PendingRetry = Readonly<{
  timeoutId: number;
  resolve: () => void;
}>;

type WorkflowStatus = TranscriptWorkflowState['status'];

type ReplacementCancellationRequest = Readonly<{
  expectedGeneration: number;
  expectedStatus: WorkflowStatus;
  activeJob: QueuedOrProcessingTranscriptJobState;
  replacementSourceVideoUrl: string | null;
}>;

type NewSubmissionRequest = Readonly<{
  expectedGeneration: number;
  expectedStatus: WorkflowStatus;
  sourceVideoUrl: string;
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

const CANCELLATION_FAILURE_MESSAGE =
  'Textify could not confirm cancellation. The Transcript Job is still active. Try again.';
const CANCELLATION_ACCEPTED_MESSAGE =
  'Cancellation accepted. Textify is cleaning up this Transcript Job.';
const CHECKING_FINAL_OUTCOME_MESSAGE =
  'This Transcript Job finished before cancellation. Checking its final outcome.';

export const useTranscriptWorkflow = (): UseTranscriptWorkflowResult => {
  const [sourceVideoUrl, setSourceVideoUrlValue] = useState('');
  const [submissionFeedback, setSubmissionFeedback] = useState<SubmissionFeedback | null>(null);
  const [workflowState, setWorkflowState] = useState<TranscriptWorkflowState>({ status: 'idle' });
  const workflowStateRef = useRef<TranscriptWorkflowState>(workflowState);
  const workflowGenerationRef = useRef(0);
  const activePollControllerRef = useRef<AbortController | null>(null);
  const activeOperationControllerRef = useRef<AbortController | null>(null);
  const pendingRetryRef = useRef<PendingRetry | null>(null);
  const isMountedRef = useRef(true);
  const isPostInFlightRef = useRef(false);
  const isCancellationInFlightRef = useRef(false);

  const commitWorkflowState = useCallback((nextState: TranscriptWorkflowState): void => {
    workflowStateRef.current = nextState;
    setWorkflowState(nextState);
  }, []);

  const claimWorkflowTransition = useCallback(({
    expectedGeneration,
    expectedStatus,
    nextState,
  }: Readonly<{
    expectedGeneration: number;
    expectedStatus: WorkflowStatus;
    nextState: TranscriptWorkflowState;
  }>): number | undefined => {
    if (
      !isMountedRef.current ||
      workflowGenerationRef.current !== expectedGeneration ||
      workflowStateRef.current.status !== expectedStatus
    ) {
      return undefined;
    }

    workflowGenerationRef.current += 1;
    activePollControllerRef.current?.abort();
    activePollControllerRef.current = null;
    commitWorkflowState(nextState);

    return workflowGenerationRef.current;
  }, [commitWorkflowState]);

  const isCurrentWorkflowState = useCallback(({
    generation,
    status,
  }: Readonly<{
    generation: number;
    status: WorkflowStatus;
  }>): boolean =>
    isMountedRef.current &&
    workflowGenerationRef.current === generation &&
    workflowStateRef.current.status === status, []);

  const startNewSubmission = useCallback(async ({
    expectedGeneration,
    expectedStatus,
    sourceVideoUrl: nextSourceVideoUrl,
  }: NewSubmissionRequest): Promise<void> => {
    if (isPostInFlightRef.current) {
      return;
    }

    isPostInFlightRef.current = true;
    const generation = claimWorkflowTransition({
      expectedGeneration,
      expectedStatus,
      nextState: { status: 'submitting', attempt: 1 },
    });

    if (generation === undefined) {
      isPostInFlightRef.current = false;
      return;
    }

    const isCurrentSubmission = (): boolean =>
      isCurrentWorkflowState({ generation, status: 'submitting' });
    const returnToIdle = (feedback: SubmissionFeedback): void => {
      if (!isCurrentSubmission()) {
        return;
      }

      commitWorkflowState({ status: 'idle' });
      setSubmissionFeedback(feedback);
    };
    const submitAttempt = async (): Promise<AttemptResult> => {
      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, SUBMISSION_TIMEOUT_MILLISECONDS);
      activeOperationControllerRef.current = controller;

      try {
        return {
          result: await submitSourceVideo({ sourceVideoUrl: nextSourceVideoUrl, signal: controller.signal }),
          timedOut,
        };
      } finally {
        window.clearTimeout(timeoutId);

        if (activeOperationControllerRef.current === controller) {
          activeOperationControllerRef.current = null;
        }
      }
    };

    try {
      const firstAttempt = await submitAttempt();

      if (!isCurrentSubmission()) {
        return;
      }

      if (firstAttempt.result.kind === 'accepted') {
        commitWorkflowState({
          status: 'queued',
          capability: firstAttempt.result.capability,
          retryAfterMilliseconds: firstAttempt.result.retryAfterMilliseconds,
          cancellationFeedback: null,
        });
        return;
      }

      if (firstAttempt.result.kind === 'backend-error') {
        returnToIdle(feedbackForBackendError(firstAttempt.result.code));
        return;
      }

      if (firstAttempt.result.kind === 'contract-error') {
        returnToIdle(GENERIC_SUBMISSION_FEEDBACK);
        return;
      }

      if (firstAttempt.result.kind === 'aborted' && !firstAttempt.timedOut) {
        return;
      }

      commitWorkflowState({ status: 'submitting', attempt: 2 });
      await waitForRetry(pendingRetryRef, retryDelayMilliseconds());

      if (!isCurrentSubmission()) {
        return;
      }

      const secondAttempt = await submitAttempt();

      if (!isCurrentSubmission()) {
        return;
      }

      if (secondAttempt.result.kind === 'accepted') {
        commitWorkflowState({
          status: 'queued',
          capability: secondAttempt.result.capability,
          retryAfterMilliseconds: secondAttempt.result.retryAfterMilliseconds,
          cancellationFeedback: null,
        });
        return;
      }

      if (secondAttempt.result.kind === 'backend-error') {
        returnToIdle(feedbackForBackendError(secondAttempt.result.code));
        return;
      }

      if (secondAttempt.result.kind === 'contract-error') {
        returnToIdle(GENERIC_SUBMISSION_FEEDBACK);
        return;
      }

      if (secondAttempt.result.kind === 'aborted' && !secondAttempt.timedOut) {
        return;
      }

      returnToIdle(AMBIGUOUS_SUBMISSION_FEEDBACK);
    } finally {
      isPostInFlightRef.current = false;
    }
  }, [claimWorkflowTransition, commitWorkflowState, isCurrentWorkflowState]);

  const requestCancellation = useCallback(async ({
    expectedGeneration,
    expectedStatus,
    activeJob,
    replacementSourceVideoUrl,
  }: ReplacementCancellationRequest): Promise<void> => {
    if (isCancellationInFlightRef.current) {
      return;
    }

    isCancellationInFlightRef.current = true;
    const generation = claimWorkflowTransition({
      expectedGeneration,
      expectedStatus,
      nextState: {
        status: 'cancellation-pending',
        activeJob,
        replacementSourceVideoUrl,
      },
    });

    if (generation === undefined) {
      isCancellationInFlightRef.current = false;
      return;
    }

    const controller = new AbortController();
    activeOperationControllerRef.current = controller;

    try {
      const result = await cancelTranscriptJob({ capability: activeJob.capability, signal: controller.signal });

      if (!isCurrentWorkflowState({ generation, status: 'cancellation-pending' })) {
        return;
      }

      if (result.kind === 'cancelled' || result.kind === 'cancelling') {
        if (replacementSourceVideoUrl !== null) {
          isCancellationInFlightRef.current = false;
          void startNewSubmission({
            expectedGeneration: generation,
            expectedStatus: 'cancellation-pending',
            sourceVideoUrl: replacementSourceVideoUrl,
          });
          return;
        }

        if (result.kind === 'cancelled') {
          commitWorkflowState({ status: 'cancelled' });
          return;
        }

        commitWorkflowState({
          status: 'cancelling',
          capability: result.capability,
          retryAfterMilliseconds: result.retryAfterMilliseconds,
          cancellationFeedback: { message: CANCELLATION_ACCEPTED_MESSAGE },
        });
        return;
      }

      if (result.kind === 'backend-error' && result.code === 'job_not_found') {
        commitWorkflowState({ status: 'expired' });
        return;
      }

      if (result.kind === 'backend-error' && result.code === 'job_already_finished') {
        if (replacementSourceVideoUrl !== null) {
          isCancellationInFlightRef.current = false;
          void startNewSubmission({
            expectedGeneration: generation,
            expectedStatus: 'cancellation-pending',
            sourceVideoUrl: replacementSourceVideoUrl,
          });
          return;
        }

        commitWorkflowState({
          status: 'checking-final-outcome',
          activeJob: withCancellationFeedback(activeJob, CHECKING_FINAL_OUTCOME_MESSAGE),
        });
        return;
      }

      if (replacementSourceVideoUrl !== null) {
        commitWorkflowState({
          status: 'confirming-replacement',
          activeJob,
          replacementSourceVideoUrl,
          feedback: {
            message: CANCELLATION_FAILURE_MESSAGE,
            politeness: 'polite',
            isInvalid: false,
          },
        });
        return;
      }

      commitWorkflowState(withCancellationFeedback(activeJob, CANCELLATION_FAILURE_MESSAGE));
    } finally {
      if (activeOperationControllerRef.current === controller) {
        activeOperationControllerRef.current = null;
      }

      isCancellationInFlightRef.current = false;
    }
  }, [claimWorkflowTransition, commitWorkflowState, isCurrentWorkflowState, startNewSubmission]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      workflowGenerationRef.current += 1;
      activePollControllerRef.current?.abort();
      activePollControllerRef.current = null;
      activeOperationControllerRef.current?.abort();
      activeOperationControllerRef.current = null;
      isPostInFlightRef.current = false;
      isCancellationInFlightRef.current = false;

      const pendingRetry = pendingRetryRef.current;

      if (pendingRetry !== null) {
        window.clearTimeout(pendingRetry.timeoutId);
        pendingRetryRef.current = null;
        pendingRetry.resolve();
      }
    };
  }, []);

  useEffect(() => {
    const activeJob = activeJobForPolling(workflowState);

    if (activeJob === undefined) {
      return;
    }

    let ownsPollingEffect = true;
    const generation = workflowGenerationRef.current;
    const expectedStatus = workflowState.status;

    const commitPollingState = (nextState: TranscriptWorkflowState): boolean => {
      if (!ownsPollingEffect || !isCurrentWorkflowState({ generation, status: expectedStatus })) {
        return false;
      }

      commitWorkflowState(nextState);
      return true;
    };
    const startReplacementAfterTerminalInspection = (): void => {
      const currentState = workflowStateRef.current;

      if (currentState.status !== 'confirming-replacement') {
        return;
      }

      void startNewSubmission({
        expectedGeneration: generation,
        expectedStatus,
        sourceVideoUrl: currentState.replacementSourceVideoUrl,
      });
    };
    const commitTerminalInspection = (result: InspectTranscriptJobResult): void => {
      if (workflowStateRef.current.status === 'confirming-replacement') {
        startReplacementAfterTerminalInspection();
        return;
      }

      switch (result.kind) {
        case 'succeeded':
          commitPollingState({ status: 'succeeded', result: result.result });
          return;
        case 'failed':
          commitPollingState({ status: 'failed', failure: { kind: 'job', code: result.code } });
          return;
        case 'cancelled':
          commitPollingState({ status: 'cancelled' });
          return;
        default:
          return;
      }
    };
    const commitActiveInspection = (result: Extract<InspectTranscriptJobResult, { kind: 'queued' | 'processing' }>): void => {
      const currentState = workflowStateRef.current;
      const nextActiveJob = activeJobForInspection({
        currentActiveJob: activeJob,
        result,
      });

      switch (currentState.status) {
        case 'queued':
        case 'processing':
        case 'cancelling':
          commitPollingState(nextActiveJob);
          return;
        case 'confirming-replacement':
          commitPollingState({
            status: 'confirming-replacement',
            activeJob: nextActiveJob,
            replacementSourceVideoUrl: currentState.replacementSourceVideoUrl,
            feedback: currentState.feedback,
          });
          return;
        case 'checking-final-outcome':
          commitPollingState({ status: 'failed', failure: { kind: 'contract' } });
          return;
        default:
          return;
      }
    };
    const poll = async (): Promise<void> => {
      if (!ownsPollingEffect || !isMountedRef.current) {
        return;
      }

      const controller = new AbortController();
      activePollControllerRef.current = controller;
      const result = await inspectTranscriptJob({ capability: activeJob.capability, signal: controller.signal });

      if (activePollControllerRef.current === controller) {
        activePollControllerRef.current = null;
      }

      if (!ownsPollingEffect || !isCurrentWorkflowState({ generation, status: expectedStatus })) {
        return;
      }

      switch (result.kind) {
        case 'queued':
        case 'processing':
          commitActiveInspection(result);
          return;
        case 'succeeded':
        case 'failed':
        case 'cancelled':
          commitTerminalInspection(result);
          return;
        case 'backend-error':
          if (result.code === 'job_not_found') {
            commitPollingState({ status: 'expired' });
            return;
          }

          commitPollingState({ status: 'failed', failure: { kind: 'backend', code: result.code } });
          return;
        case 'network-error':
          commitPollingState({ status: 'failed', failure: { kind: 'network' } });
          return;
        case 'contract-error':
          commitPollingState({ status: 'failed', failure: { kind: 'contract' } });
          return;
        case 'aborted':
          return;
      }
    };

    const timeoutId = window.setTimeout(() => {
      void poll();
    }, activeJob.retryAfterMilliseconds);

    return () => {
      ownsPollingEffect = false;
      window.clearTimeout(timeoutId);
      activePollControllerRef.current?.abort();
      activePollControllerRef.current = null;
    };
  }, [commitWorkflowState, isCurrentWorkflowState, startNewSubmission, workflowState]);

  const setSourceVideoUrl = useCallback((value: string): void => {
    setSourceVideoUrlValue(value);
    setSubmissionFeedback(null);
  }, []);

  const submitSourceVideoUrl = useCallback(async (): Promise<void> => {
    const currentState = workflowStateRef.current;

    if (isSourceVideoSubmissionLockedState(currentState) || isPostInFlightRef.current) {
      return;
    }

    const trimmedSourceVideoUrl = sourceVideoUrl.trim();
    const validationFeedback = validateSourceVideoUrl(trimmedSourceVideoUrl);

    if (validationFeedback !== null) {
      setSubmissionFeedback(validationFeedback);
      return;
    }

    setSourceVideoUrlValue(trimmedSourceVideoUrl);
    setSubmissionFeedback(null);
    const generation = workflowGenerationRef.current;

    switch (currentState.status) {
      case 'idle':
      case 'succeeded':
      case 'failed':
      case 'cancelled':
      case 'expired':
        await startNewSubmission({
          expectedGeneration: generation,
          expectedStatus: currentState.status,
          sourceVideoUrl: trimmedSourceVideoUrl,
        });
        return;
      case 'queued':
      case 'processing':
      case 'cancelling':
        claimWorkflowTransition({
          expectedGeneration: generation,
          expectedStatus: currentState.status,
          nextState: {
            status: 'confirming-replacement',
            activeJob: currentState,
            replacementSourceVideoUrl: trimmedSourceVideoUrl,
            feedback: null,
          },
        });
        return;
      case 'submitting':
      case 'confirming-replacement':
      case 'cancellation-pending':
      case 'checking-final-outcome':
        return;
    }
  }, [claimWorkflowTransition, sourceVideoUrl, startNewSubmission]);

  const cancelActiveTranscriptJob = useCallback(async (): Promise<void> => {
    const currentState = workflowStateRef.current;

    if (currentState.status !== 'queued' && currentState.status !== 'processing') {
      return;
    }

    await requestCancellation({
      expectedGeneration: workflowGenerationRef.current,
      expectedStatus: currentState.status,
      activeJob: currentState,
      replacementSourceVideoUrl: null,
    });
  }, [requestCancellation]);

  const confirmReplacement = useCallback(async (): Promise<void> => {
    const currentState = workflowStateRef.current;

    if (currentState.status !== 'confirming-replacement') {
      return;
    }

    const generation = workflowGenerationRef.current;

    if (currentState.activeJob.status === 'cancelling') {
      await startNewSubmission({
        expectedGeneration: generation,
        expectedStatus: 'confirming-replacement',
        sourceVideoUrl: currentState.replacementSourceVideoUrl,
      });
      return;
    }

    await requestCancellation({
      expectedGeneration: generation,
      expectedStatus: 'confirming-replacement',
      activeJob: currentState.activeJob,
      replacementSourceVideoUrl: currentState.replacementSourceVideoUrl,
    });
  }, [requestCancellation, startNewSubmission]);

  const declineReplacement = useCallback((): void => {
    const currentState = workflowStateRef.current;

    if (currentState.status !== 'confirming-replacement') {
      return;
    }

    claimWorkflowTransition({
      expectedGeneration: workflowGenerationRef.current,
      expectedStatus: 'confirming-replacement',
      nextState: currentState.activeJob,
    });
  }, [claimWorkflowTransition]);

  return {
    sourceVideoUrl,
    workflowState,
    submissionFeedback,
    isSourceVideoSubmissionLocked: isSourceVideoSubmissionLockedState(workflowState),
    setSourceVideoUrl,
    submitSourceVideoUrl,
    cancelActiveTranscriptJob,
    confirmReplacement,
    declineReplacement,
  };
};

const activeJobForPolling = (state: TranscriptWorkflowState): ActiveTranscriptJobState | undefined => {
  switch (state.status) {
    case 'queued':
    case 'processing':
    case 'cancelling':
      return state;
    case 'confirming-replacement':
      return state.activeJob;
    case 'checking-final-outcome':
      return state.activeJob;
    case 'idle':
    case 'submitting':
    case 'cancellation-pending':
    case 'succeeded':
    case 'failed':
    case 'cancelled':
    case 'expired':
      return undefined;
  }
};

const activeJobForInspection = ({
  currentActiveJob,
  result,
}: Readonly<{
  currentActiveJob: ActiveTranscriptJobState;
  result: Extract<InspectTranscriptJobResult, { kind: 'queued' | 'processing' }>;
}>): ActiveTranscriptJobState => {
  if (currentActiveJob.status === 'cancelling' || result.kind === 'processing' && result.cancellationRequested) {
    return {
      status: 'cancelling',
      capability: result.capability,
      retryAfterMilliseconds: result.retryAfterMilliseconds,
      cancellationFeedback: currentActiveJob.cancellationFeedback ?? {
        message: CANCELLATION_ACCEPTED_MESSAGE,
      },
    };
  }

  return {
    status: result.kind,
    capability: result.capability,
    retryAfterMilliseconds: result.retryAfterMilliseconds,
    cancellationFeedback: currentActiveJob.cancellationFeedback,
  };
};

const withCancellationFeedback = (
  activeJob: QueuedOrProcessingTranscriptJobState,
  message: string,
): QueuedOrProcessingTranscriptJobState => ({
  ...activeJob,
  cancellationFeedback: { message },
});

const isSourceVideoSubmissionLockedState = (state: TranscriptWorkflowState): boolean => {
  switch (state.status) {
    case 'submitting':
    case 'confirming-replacement':
    case 'cancellation-pending':
    case 'checking-final-outcome':
      return true;
    case 'idle':
    case 'queued':
    case 'processing':
    case 'cancelling':
    case 'succeeded':
    case 'failed':
    case 'cancelled':
    case 'expired':
      return false;
  }
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
