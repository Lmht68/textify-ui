import { useEffect } from 'react';
import type { FormEvent, RefObject } from 'react';

import './SourceVideoSubmissionForm.css';

import type { SubmissionFeedback } from '../../hooks/useTranscriptWorkflow';

type SourceVideoSubmissionFormProps = Readonly<{
  inputRef: RefObject<HTMLInputElement | null>;
  sourceVideoUrl: string;
  feedback: SubmissionFeedback | null;
  isLocked: boolean;
  onSourceVideoUrlChange: (value: string) => void;
  onSubmitSourceVideo: () => Promise<void>;
}>;

export const SourceVideoSubmissionForm = ({
  inputRef,
  sourceVideoUrl,
  feedback,
  isLocked,
  onSourceVideoUrlChange,
  onSubmitSourceVideo,
}: SourceVideoSubmissionFormProps) => {
  useEffect(() => {
    if (feedback?.politeness === 'assertive') {
      inputRef.current?.focus();
    }
  }, [feedback, inputRef]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void onSubmitSourceVideo();
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
          readOnly={isLocked}
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
      <button className="submission-rail__submit" type="submit" disabled={isLocked}>
        Get transcript
      </button>
    </form>
  );
};
