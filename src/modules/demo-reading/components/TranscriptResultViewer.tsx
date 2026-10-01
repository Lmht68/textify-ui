import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import {
  buildYouTubeTimecodeUrl,
  findLiteralMatches,
  formatTimestamp,
} from '../transcriptResultView';

import type { LiteralMatch, TranscriptView } from '../transcriptResultView';
import type { TranscriptResult } from '../../transcript-jobs/transport';

type TranscriptResultViewerProps = Readonly<{
  activeView: TranscriptView;
  canonicalSourceUrl: string;
  languageTag: string | undefined;
  platform: TranscriptResult['source']['platform'];
  transcript: TranscriptResult['transcript'];
  onActiveViewChange: (view: TranscriptView) => void;
}>;

type SearchField = Readonly<{
  key: string;
  text: string;
}>;

type SearchMatch = Readonly<
  LiteralMatch & {
    fieldKey: string;
    index: number;
  }
>;

type SearchResult = Readonly<{
  matches: ReadonlyArray<SearchMatch>;
  matchesByField: ReadonlyMap<string, ReadonlyArray<SearchMatch>>;
}>;

type CurrentMatch = Readonly<{
  view: TranscriptView;
  query: string;
  index: number;
}>;

type TimestampRow = Readonly<{
  index: number;
  timestamp: string;
  segment: TranscriptResult['transcript']['segments'][number];
}>;

const EMPTY_SEARCH_MATCHES: ReadonlyArray<SearchMatch> = Object.freeze([]);
const EMPTY_TIMESTAMP_ROWS: ReadonlyArray<TimestampRow> = Object.freeze([]);

export const TranscriptResultViewer = ({
  activeView,
  canonicalSourceUrl,
  languageTag,
  platform,
  transcript,
  onActiveViewChange,
}: TranscriptResultViewerProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchState, setCurrentMatchState] = useState<CurrentMatch | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Record<TranscriptView, HTMLButtonElement | null>>({
    plain: null,
    timestamps: null,
  });
  const hasSegments = transcript.segments.length > 0;
  const timestampRows = useMemo<ReadonlyArray<TimestampRow>>(
    () =>
      activeView === 'timestamps'
        ? transcript.segments.map((segment, index) => ({
          index,
          timestamp: formatTimestamp(segment.start),
          segment,
        }))
        : EMPTY_TIMESTAMP_ROWS,
    [activeView, transcript.segments],
  );
  const searchFields = useMemo<ReadonlyArray<SearchField>>(
    () =>
      activeView === 'plain'
        ? [{ key: 'plain-text', text: transcript.text }]
        : timestampRows.flatMap(({ index, segment, timestamp }) => [
          { key: `timestamp-${index}`, text: timestamp },
          { key: `segment-${index}`, text: segment.text },
        ]),
    [activeView, timestampRows, transcript.text],
  );
  const searchResult = useMemo<SearchResult>(() => {
    const matches: Array<SearchMatch> = [];
    const matchesByField = new Map<string, Array<SearchMatch>>();

    for (const field of searchFields) {
      const fieldMatches = findLiteralMatches({ query: searchQuery, text: field.text });

      for (const match of fieldMatches) {
        const searchMatch = { ...match, fieldKey: field.key, index: matches.length };
        matches.push(searchMatch);
        const existingMatches = matchesByField.get(field.key);

        if (existingMatches === undefined) {
          matchesByField.set(field.key, [searchMatch]);
        } else {
          existingMatches.push(searchMatch);
        }
      }
    }

    return { matches, matchesByField };
  }, [searchFields, searchQuery]);
  const currentMatchIndex =
    searchResult.matches.length === 0 ||
      currentMatchState === null ||
      currentMatchState.view !== activeView ||
      currentMatchState.query !== searchQuery ||
      currentMatchState.index >= searchResult.matches.length
      ? searchResult.matches.length === 0
        ? null
        : 0
      : currentMatchState.index;
  const hasSearchableContent = searchFields.some(({ text }) => text.length > 0);

  useEffect(() => {
    if (currentMatchIndex !== null) {
      viewerRef.current
        ?.querySelector<HTMLElement>('.transcript__match--current')
        ?.scrollIntoView({
          behavior: 'instant',
          block: 'nearest',
          inline: 'nearest',
        });
    }
  }, [activeView, currentMatchIndex, searchQuery]);


  const activateView = useCallback(
    (view: TranscriptView): void => {
      if (view === 'timestamps' && !hasSegments) {
        return;
      }

      onActiveViewChange(view);
    },
    [hasSegments, onActiveViewChange],
  );

  const handleTabKeyDown = (view: TranscriptView, event: KeyboardEvent<HTMLButtonElement>): void => {
    const key = event.key;

    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') {
      return;
    }

    event.preventDefault();

    if (!hasSegments) {
      activateView('plain');
      tabRefs.current.plain?.focus();
      return;
    }

    const nextView =
      key === 'Home' ? 'plain' : key === 'End' ? 'timestamps' : view === 'plain' ? 'timestamps' : 'plain';

    activateView(nextView);
    tabRefs.current[nextView]?.focus();
  };

  const moveCurrentMatch = (offset: -1 | 1): void => {
    if (currentMatchIndex === null) {
      return;
    }

    const nextIndex = (currentMatchIndex + offset + searchResult.matches.length) % searchResult.matches.length;
    setCurrentMatchState({ view: activeView, query: searchQuery, index: nextIndex });
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      setSearchQuery('');
    }
  };

  return (
    <article className="transcript" aria-labelledby="transcript-result-heading" ref={viewerRef}>
      <div className="transcript__view-controls">
        <div aria-label="Transcript views" role="tablist">
          <button
            aria-controls="transcript-plain-panel"
            aria-selected={activeView === 'plain'}
            className="transcript__view-tab"
            id="transcript-plain-tab"
            onClick={() => {
              activateView('plain');
            }}
            onKeyDown={(event) => {
              handleTabKeyDown('plain', event);
            }}
            ref={(element) => {
              tabRefs.current.plain = element;
            }}
            role="tab"
            tabIndex={activeView === 'plain' ? 0 : -1}
            type="button"
          >
            Plain text
          </button>
          <button
            aria-controls="transcript-timestamps-panel"
            aria-describedby={hasSegments ? undefined : 'transcript-timestamps-unavailable'}
            aria-disabled={hasSegments ? undefined : true}
            aria-selected={activeView === 'timestamps'}
            className="transcript__view-tab"
            id="transcript-timestamps-tab"
            onClick={() => {
              activateView('timestamps');
            }}
            onKeyDown={(event) => {
              handleTabKeyDown('timestamps', event);
            }}
            ref={(element) => {
              tabRefs.current.timestamps = element;
            }}
            role="tab"
            tabIndex={hasSegments && activeView === 'timestamps' ? 0 : -1}
            type="button"
          >
            Timestamps
          </button>
        </div>
        {hasSegments ? null : (
          <p className="transcript__timestamps-unavailable" id="transcript-timestamps-unavailable">
            Timestamps aren't available because this Transcript has no Transcript Segments.
          </p>
        )}
      </div>
      <div aria-labelledby="transcript-search-label" className="transcript__search" role="search">
        <label htmlFor="transcript-search" id="transcript-search-label">
          Search Transcript
        </label>
        <input
          aria-describedby={hasSearchableContent ? undefined : 'transcript-empty-state'}
          disabled={!hasSearchableContent}
          id="transcript-search"
          onChange={(event) => {
            setSearchQuery(event.target.value);
          }}
          onKeyDown={handleSearchKeyDown}
          type="search"
          value={searchQuery}
        />
        <div className="transcript__search-actions">
          <button
            aria-label="Previous match"
            disabled={currentMatchIndex === null}
            onClick={() => {
              moveCurrentMatch(-1);
            }}
            type="button"
          >
            Previous
          </button>
          <button
            aria-label="Next match"
            disabled={currentMatchIndex === null}
            onClick={() => {
              moveCurrentMatch(1);
            }}
            type="button"
          >
            Next
          </button>
        </div>
        <output aria-atomic="true" aria-label="Search feedback" aria-live="polite" role="status">
          {searchQuery === ''
            ? ''
            : currentMatchIndex === null
              ? 'No matches.'
              : `${currentMatchIndex + 1} of ${searchResult.matches.length} matches.`}
        </output>
      </div>
      <div
        aria-labelledby="transcript-plain-tab"
        hidden={activeView !== 'plain'}
        id="transcript-plain-panel"
        role="tabpanel"
      >
        {activeView !== 'plain' ? null : transcript.text === '' ? (
          <p className="transcript__empty-state" id="transcript-empty-state">
            No spoken text was detected in this Source Video.
          </p>
        ) : (
          <p lang={languageTag} dir="auto">
            {renderHighlightedText({
              text: transcript.text,
              matches: searchResult.matchesByField.get('plain-text') ?? EMPTY_SEARCH_MATCHES,
              currentMatchIndex,
            })}
          </p>
        )}
      </div>
      <div
        aria-labelledby="transcript-timestamps-tab"
        hidden={activeView !== 'timestamps'}
        id="transcript-timestamps-panel"
        role="tabpanel"
      >
        {activeView !== 'timestamps' ? null : (
          <ol className="transcript__segments">
            {timestampRows.map(({ index, segment, timestamp }) => {
              const time = (
                <time dateTime={`PT${Math.floor(segment.start)}S`} dir="ltr">
                  {renderHighlightedText({
                    text: timestamp,
                    matches: searchResult.matchesByField.get(`timestamp-${index}`) ?? EMPTY_SEARCH_MATCHES,
                    currentMatchIndex,
                  })}
                </time>
              );

              return (
                <li className="transcript__segment" key={`${segment.start}-${index}`}>
                  {platform === 'youtube' ? (
                    <a
                      aria-label={`Open source at ${timestamp}`}
                      className="transcript__time-link"
                      href={buildYouTubeTimecodeUrl({
                        canonicalSourceUrl,
                        startSeconds: segment.start,
                      })}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {time}
                    </a>
                  ) : (
                    time
                  )}
                  <p lang={languageTag} dir="auto">
                    {renderHighlightedText({
                      text: segment.text,
                      matches: searchResult.matchesByField.get(`segment-${index}`) ?? EMPTY_SEARCH_MATCHES,
                      currentMatchIndex,
                    })}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </article>
  );
};

const renderHighlightedText = ({
  text,
  matches,
  currentMatchIndex,
}: Readonly<{
  text: string;
  matches: ReadonlyArray<SearchMatch>;
  currentMatchIndex: number | null;
}>): ReadonlyArray<ReactNode> => {
  if (matches.length === 0) {
    return [text];
  }

  const content: Array<ReactNode> = [];
  let previousEnd = 0;

  for (const match of matches) {
    if (match.start > previousEnd) {
      content.push(text.slice(previousEnd, match.start));
    }

    const isCurrent = match.index === currentMatchIndex;
    content.push(
      <mark
        className={isCurrent ? 'transcript__match transcript__match--current' : 'transcript__match'}
        key={`${match.start}-${match.end}`}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    previousEnd = match.end;
  }

  if (previousEnd < text.length) {
    content.push(text.slice(previousEnd));
  }

  return content;
};
