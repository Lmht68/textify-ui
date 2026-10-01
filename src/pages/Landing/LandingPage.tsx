import { useRef } from 'react';

import './LandingPage.css';

import {
  SourceVideoSubmissionForm,
  TranscriptReadingWindow,
  useTranscriptWorkflow,
} from '../../features/transcript-workflow';
import { HowItWorks } from './components/HowItWorks';
import { SiteHeader } from './components/SiteHeader';

const SUPPORTED_PLATFORMS = ['YouTube', 'TikTok', 'Instagram', 'Facebook', 'X'] as const;

export const LandingPage = () => {
  const sourceVideoInputRef = useRef<HTMLInputElement | null>(null);
  const { sourceVideoUrl, workflowState, setSourceVideoUrl, submitSourceVideoUrl } = useTranscriptWorkflow();
  const feedback = workflowState.status === 'idle' ? workflowState.feedback : null;

  const handleWordmarkActivate = () => {
    sourceVideoInputRef.current?.focus();
  };

  return (
    <>
      <SiteHeader onWordmarkActivate={handleWordmarkActivate} />
      <main>
        <section className="introduction site-shell" id="submission-region" aria-labelledby="introduction-heading">
          <h1 id="introduction-heading">Turn videos into text you can actually use</h1>
          <p>
            Textify turns one public video into a readable Transcript in its original language - no account required.
          </p>
          <SourceVideoSubmissionForm
            inputRef={sourceVideoInputRef}
            sourceVideoUrl={sourceVideoUrl}
            feedback={feedback}
            isLocked={workflowState.status !== 'idle'}
            onSourceVideoUrlChange={setSourceVideoUrl}
            onSubmitSourceVideo={submitSourceVideoUrl}
          />
          <div className="platforms">
            <p>Works with public videos from</p>
            <ul aria-label="Supported Platforms">
              {SUPPORTED_PLATFORMS.map((platform) => (
                <li key={platform}>{platform}</li>
              ))}
            </ul>
          </div>
        </section>
        <TranscriptReadingWindow workflowState={workflowState} />
        <HowItWorks />
      </main>
    </>
  );
};
