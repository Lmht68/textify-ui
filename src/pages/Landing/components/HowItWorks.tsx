import './HowItWorks.css';

const STEPS = [
  {
    title: 'Submit one public link',
    body: 'Use a public YouTube, TikTok, Instagram, Facebook, or X video up to 30 minutes long.',
  },
  {
    title: 'Textify finds the words',
    body: 'Textify uses Source Captions when they are usable and falls back to audio transcription when needed.',
  },
  {
    title: 'Read the Transcript',
    body: 'Copy and download a completed Transcript in its detected original language.',
  },
] as const;

export const HowItWorks = () => (
  <section className="how-it-works site-shell" id="how-it-works" aria-labelledby="how-it-works-heading">
    <h2 id="how-it-works-heading">How Textify works</h2>
    <ol className="how-it-works__steps">
      {STEPS.map((step) => (
        <li key={step.title}>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </li>
      ))}
    </ol>
  </section>
);
