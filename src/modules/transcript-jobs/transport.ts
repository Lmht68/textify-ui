import { zErrorResponse, zQueuedTranscriptionJobResponse } from '../../generated/textify-api/zod.gen';
import type { ErrorDetail } from '../../generated/textify-api/types.gen';

const TRANSCRIPT_JOB_PATH_PREFIX = '/api/transcription-jobs/';

type JsonResponseResult = { kind: 'parsed'; body: unknown } | { kind: 'aborted' } | { kind: 'invalid' };

export type TranscriptJobCapability = Readonly<{
  self: string;
  cancel: string;
}>;

export type TranscriptJobErrorCode = ErrorDetail['code'];

export type SubmitSourceVideoResult =
  | Readonly<{
      kind: 'accepted';
      capability: TranscriptJobCapability;
      retryAfterMilliseconds: number;
    }>
  | Readonly<{
      kind: 'backend-error';
      code: TranscriptJobErrorCode;
      requestId?: string;
    }>
  | Readonly<{ kind: 'network-error' }>
  | Readonly<{ kind: 'aborted' }>
  | Readonly<{ kind: 'contract-error' }>;

export const submitSourceVideo = async ({
  sourceVideoUrl,
  signal,
}: Readonly<{
  sourceVideoUrl: string;
  signal: AbortSignal;
}>): Promise<SubmitSourceVideoResult> => {
  let response: Response;

  try {
    response = await fetch('/api/transcription-jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: sourceVideoUrl }),
      cache: 'no-store',
      signal,
    });
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) {
      return { kind: 'aborted' };
    }

    return { kind: 'network-error' };
  }

  if (signal.aborted) {
    return { kind: 'aborted' };
  }

  switch (response.status) {
    case 202:
      return parseAcceptedResponse(response, signal);
    case 400:
    case 422:
    case 500:
    case 503:
      return parseBackendError(response, signal);
    default:
      return { kind: 'contract-error' };
  }
};

const parseAcceptedResponse = async (
  response: Response,
  signal: AbortSignal,
): Promise<SubmitSourceVideoResult> => {
  const parsedJson = await parseJson(response, signal);

  if (parsedJson.kind === 'aborted') {
    return { kind: 'aborted' };
  }

  if (parsedJson.kind === 'invalid') {
    return { kind: 'contract-error' };
  }

  const parsedResponse = zQueuedTranscriptionJobResponse.safeParse(parsedJson.body);

  if (!parsedResponse.success) {
    return { kind: 'contract-error' };
  }

  const location = nonemptyHeader(response.headers, 'Location');
  const requestId = nonemptyHeader(response.headers, 'X-Request-ID');
  const cacheControl = nonemptyHeader(response.headers, 'Cache-Control');
  const retryAfterMilliseconds = parseRetryAfterMilliseconds(response.headers.get('Retry-After'));

  if (
    location === undefined ||
    requestId === undefined ||
    cacheControl === undefined ||
    !hasNoStoreDirective(cacheControl) ||
    retryAfterMilliseconds === undefined
  ) {
    return { kind: 'contract-error' };
  }

  const normalizedLocation = resolveCapability(location);
  const normalizedSelf = resolveCapability(parsedResponse.data.links.self);
  const normalizedCancel = resolveCapability(parsedResponse.data.links.cancel);

  if (
    normalizedLocation === undefined ||
    normalizedSelf === undefined ||
    normalizedCancel === undefined ||
    normalizedLocation.href !== normalizedSelf.href
  ) {
    return { kind: 'contract-error' };
  }

  return {
    kind: 'accepted',
    capability: {
      self: parsedResponse.data.links.self,
      cancel: parsedResponse.data.links.cancel,
    },
    retryAfterMilliseconds,
  };
};

const parseBackendError = async (
  response: Response,
  signal: AbortSignal,
): Promise<SubmitSourceVideoResult> => {
  const parsedJson = await parseJson(response, signal);

  if (parsedJson.kind === 'aborted') {
    return { kind: 'aborted' };
  }

  if (parsedJson.kind === 'invalid') {
    return { kind: 'contract-error' };
  }

  const parsedResponse = zErrorResponse.safeParse(parsedJson.body);

  if (!parsedResponse.success) {
    return { kind: 'contract-error' };
  }

  const requestId = nonemptyHeader(response.headers, 'X-Request-ID');

  return requestId === undefined
    ? { kind: 'backend-error', code: parsedResponse.data.error.code }
    : { kind: 'backend-error', code: parsedResponse.data.error.code, requestId };
};

const parseJson = async (response: Response, signal: AbortSignal): Promise<JsonResponseResult> => {
  try {
    return { kind: 'parsed', body: await response.json() };
  } catch (error: unknown) {
    return signal.aborted || isAbortError(error) ? { kind: 'aborted' } : { kind: 'invalid' };
  }
};

const nonemptyHeader = (headers: Headers, name: string): string | undefined => {
  const value = headers.get(name);

  return value === null || value.trim() === '' ? undefined : value.trim();
};

const hasNoStoreDirective = (cacheControl: string): boolean =>
  cacheControl.split(',').some((directive) => directive.trim().toLowerCase() === 'no-store');

const parseRetryAfterMilliseconds = (value: string | null): number | undefined => {
  if (value === null || !/^\d+$/u.test(value)) {
    return undefined;
  }

  const seconds = Number(value);
  const milliseconds = seconds * 1_000;

  return Number.isSafeInteger(seconds) && Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
};

const resolveCapability = (capability: string): URL | undefined => {
  try {
    const resolved = new URL(capability, window.location.origin);

    if (
      resolved.origin !== window.location.origin ||
      !resolved.pathname.startsWith(TRANSCRIPT_JOB_PATH_PREFIX) ||
      resolved.pathname.length === TRANSCRIPT_JOB_PATH_PREFIX.length
    ) {
      return undefined;
    }

    return resolved;
  } catch {
    return undefined;
  }
};

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';
