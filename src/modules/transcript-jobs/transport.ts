import {
  zErrorResponse,
  zQueuedTranscriptionJobResponse,
  zTranscriptionJobResponse,
} from '../../generated/textify-api/zod.gen';
import type {
  ErrorDetail,
  Platform,
} from '../../generated/textify-api/types.gen';

const TRANSCRIPT_JOB_PATH_PREFIX = '/api/transcription-jobs/';
const DEFAULT_POLL_DELAY_MILLISECONDS = 2_000;

type JsonResponseResult = { kind: 'parsed'; body: unknown } | { kind: 'aborted' } | { kind: 'invalid' };
type TranscriptResultProjection = Readonly<{
  source: Readonly<{
    platform?: Platform | undefined;
    url?: string | undefined;
    title?: string | undefined;
    channel?: string | undefined;
    duration_seconds?: number | undefined;
  }>;
  transcript: Readonly<{
    language?: string | undefined;
    text?: string | undefined;
  }>;
}>;


export type TranscriptJobCapability = Readonly<{
  self: string;
  cancel: string;
}>;

export type TranscriptJobErrorCode = ErrorDetail['code'];

export type TranscriptResult = Readonly<{
  source: Readonly<{
    platform: Platform;
    url: string;
    title: string;
    channel: string;
    durationSeconds: number;
  }>;
  transcript: Readonly<{
    language: string;
    text: string;
  }>;
}>;

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

export type InspectTranscriptJobResult =
  | Readonly<{
    kind: 'queued';
    capability: TranscriptJobCapability;
    retryAfterMilliseconds: number;
  }>
  | Readonly<{
    kind: 'processing';
    capability: TranscriptJobCapability;
    retryAfterMilliseconds: number;
  }>
  | Readonly<{ kind: 'succeeded'; result: TranscriptResult }>
  | Readonly<{ kind: 'failed'; code: TranscriptJobErrorCode }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'backend-error'; code: TranscriptJobErrorCode }>
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

export const inspectTranscriptJob = async ({
  capability,
  signal,
}: Readonly<{
  capability: TranscriptJobCapability;
  signal: AbortSignal;
}>): Promise<InspectTranscriptJobResult> => {
  if (resolveCapability(capability.self) === undefined) {
    return { kind: 'contract-error' };
  }

  let response: Response;

  try {
    response = await fetch(capability.self, {
      method: 'GET',
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
    case 200:
      return parseInspectionResponse(response, signal, capability);
    case 404:
    case 422:
    case 500:
    case 503:
      return parseInspectionBackendError(response, signal);
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

  if (location === undefined || !hasRequiredResponseHeaders(response.headers)) {
    return { kind: 'contract-error' };
  }

  const normalizedLocation = resolveCapability(location);
  const capability = resolveActiveCapability({
    links: parsedResponse.data.links,
    expectedSelf: normalizedLocation,
  });

  return capability === undefined
    ? { kind: 'contract-error' }
    : {
      kind: 'accepted',
      capability,
      retryAfterMilliseconds: parseRetryAfterMilliseconds(response.headers.get('Retry-After')),
    };
};

const parseInspectionResponse = async (
  response: Response,
  signal: AbortSignal,
  inspectedCapability: TranscriptJobCapability,
): Promise<InspectTranscriptJobResult> => {
  const parsedJson = await parseJson(response, signal);

  if (parsedJson.kind === 'aborted') {
    return { kind: 'aborted' };
  }

  if (parsedJson.kind === 'invalid') {
    return { kind: 'contract-error' };
  }

  const parsedResponse = zTranscriptionJobResponse.safeParse(parsedJson.body);

  if (!parsedResponse.success || !hasRequiredResponseHeaders(response.headers)) {
    return { kind: 'contract-error' };
  }

  const expectedSelf = resolveCapability(inspectedCapability.self);
  const resolvedSelf = resolveCapability(parsedResponse.data.links.self);

  if (expectedSelf === undefined || resolvedSelf === undefined || resolvedSelf.href !== expectedSelf.href) {
    return { kind: 'contract-error' };
  }

  switch (parsedResponse.data.status) {
    case 'queued':
    case 'processing': {
      const capability = resolveActiveCapability({
        links: parsedResponse.data.links,
        expectedSelf,
      });

      return capability === undefined
        ? { kind: 'contract-error' }
        : {
          kind: parsedResponse.data.status,
          capability,
          retryAfterMilliseconds: parseRetryAfterMilliseconds(response.headers.get('Retry-After')),
        };
    }
    case 'finished':
      switch (parsedResponse.data.outcome) {
        case 'succeeded': {
          const result = projectTranscriptResult(parsedResponse.data.result);

          return result === undefined ? { kind: 'contract-error' } : { kind: 'succeeded', result };
        }
        case 'failed':
          return { kind: 'failed', code: parsedResponse.data.error.code };
        case 'cancelled':
          return { kind: 'cancelled' };
      }
  }
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

const parseInspectionBackendError = async (
  response: Response,
  signal: AbortSignal,
): Promise<InspectTranscriptJobResult> => {
  const parsedJson = await parseJson(response, signal);

  if (parsedJson.kind === 'aborted') {
    return { kind: 'aborted' };
  }

  if (parsedJson.kind === 'invalid') {
    return { kind: 'contract-error' };
  }

  const parsedResponse = zErrorResponse.safeParse(parsedJson.body);

  return parsedResponse.success && hasRequiredResponseHeaders(response.headers)
    ? { kind: 'backend-error', code: parsedResponse.data.error.code }
    : { kind: 'contract-error' };
};

const projectTranscriptResult = (result: TranscriptResultProjection): TranscriptResult | undefined => {
  const { source, transcript } = result;

  if (
    source.platform === undefined ||
    source.url === undefined ||
    source.title === undefined ||
    source.channel === undefined ||
    source.duration_seconds === undefined ||
    transcript.language === undefined ||
    transcript.text === undefined ||
    !isAbsoluteHttpsUrl(source.url)
  ) {
    return undefined;
  }

  return {
    source: {
      platform: source.platform,
      url: source.url,
      title: source.title,
      channel: source.channel,
      durationSeconds: source.duration_seconds,
    },
    transcript: {
      language: transcript.language,
      text: transcript.text,
    },
  };
};

const parseJson = async (response: Response, signal: AbortSignal): Promise<JsonResponseResult> => {
  try {
    return { kind: 'parsed', body: await response.json() };
  } catch (error: unknown) {
    return signal.aborted || isAbortError(error) ? { kind: 'aborted' } : { kind: 'invalid' };
  }
};

const hasRequiredResponseHeaders = (headers: Headers): boolean => {
  const cacheControl = nonemptyHeader(headers, 'Cache-Control');

  return (
    nonemptyHeader(headers, 'X-Request-ID') !== undefined &&
    cacheControl !== undefined &&
    cacheControl.split(',').some((directive) => directive.trim().toLowerCase() === 'no-store')
  );
};

const nonemptyHeader = (headers: Headers, name: string): string | undefined => {
  const value = headers.get(name);

  return value === null || value.trim() === '' ? undefined : value.trim();
};

const parseRetryAfterMilliseconds = (value: string | null): number => {
  const normalizedValue = value?.trim() ?? '';

  if (!/^[1-9]\d*$/u.test(normalizedValue)) {
    return DEFAULT_POLL_DELAY_MILLISECONDS;
  }

  const seconds = Number(normalizedValue);
  const milliseconds = seconds * 1_000;

  return Number.isSafeInteger(seconds) && Number.isSafeInteger(milliseconds)
    ? milliseconds
    : DEFAULT_POLL_DELAY_MILLISECONDS;
};

const resolveActiveCapability = ({
  links,
  expectedSelf,
}: Readonly<{
  links: TranscriptJobCapability;
  expectedSelf: URL | undefined;
}>): TranscriptJobCapability | undefined => {
  if (expectedSelf === undefined) {
    return undefined;
  }

  const resolvedSelf = resolveCapability(links.self);
  const resolvedCancel = resolveCapability(links.cancel);
  const expectedCancel = new URL(expectedSelf.href);
  expectedCancel.pathname = `${expectedSelf.pathname}/cancellation`;

  return resolvedSelf?.href === expectedSelf.href && resolvedCancel?.href === expectedCancel.href ? links : undefined;
};

const isAbsoluteHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
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
