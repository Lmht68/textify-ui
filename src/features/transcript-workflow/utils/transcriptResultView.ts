import type { TranscriptResult } from '../services/transcriptJobs';

export type TranscriptView = 'plain' | 'timestamps';

export type LiteralMatch = Readonly<{
  start: number;
  end: number;
}>;

const MAX_FILENAME_BASE_CODE_POINTS = 50;

export const formatTimestamp = (startSeconds: number): string => {
  const wholeSeconds = Math.floor(startSeconds);
  const seconds = wholeSeconds % 60;
  const minutes = Math.floor(wholeSeconds / 60) % 60;
  const hours = Math.floor(wholeSeconds / 3_600);

  return hours === 0
    ? `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const buildTranscriptExportText = ({
  transcript,
  view,
}: Readonly<{
  transcript: TranscriptResult['transcript'];
  view: TranscriptView;
}>): string => {
  if (view === 'plain') {
    return `${transcript.text}\n`;
  }

  return `${transcript.segments
    .map((segment) => `[${formatTimestamp(segment.start)}] ${segment.text}`)
    .join('\n')}\n`;
};

export const buildTranscriptDownloadFilename = ({
  platformName,
  title,
  view,
}: Readonly<{
  platformName: string;
  title: string;
  view: TranscriptView;
}>): string => {
  const safeBase = sanitizeFilenameBase(title) || sanitizeFilenameBase(`${platformName} video`) || 'video';
  const suffix = view === 'plain' ? '-transcript.txt' : '-transcript-timestamps.txt';

  return `${safeBase}${suffix}`;
};

export const buildYouTubeTimecodeUrl = ({
  canonicalSourceUrl,
  startSeconds,
}: Readonly<{
  canonicalSourceUrl: string;
  startSeconds: number;
}>): string => {
  const url = new URL(canonicalSourceUrl);
  url.searchParams.set('t', String(Math.floor(startSeconds)));

  return url.toString();
};

export const findLiteralMatches = ({
  query,
  text,
}: Readonly<{
  query: string;
  text: string;
}>): ReadonlyArray<LiteralMatch> => {
  if (query === '') {
    return [];
  }

  const expression = new RegExp(escapeRegularExpression(query), 'giu');
  const matches: Array<LiteralMatch> = [];

  for (const match of text.matchAll(expression)) {
    const value = match[0];
    const start = match.index;

    if (value === undefined || start === undefined) {
      continue;
    }

    matches.push({ start, end: start + value.length });
  }

  return matches;
};

const sanitizeFilenameBase = (value: string): string => {
  const normalized = value.trim().normalize('NFC').toLowerCase();
  const hyphenated = normalized.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/gu, '');
  const truncated = Array.from(hyphenated).slice(0, MAX_FILENAME_BASE_CODE_POINTS).join('');

  return truncated.replace(/-+$/u, '');
};

const escapeRegularExpression = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
