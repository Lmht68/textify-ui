import './SiteHeader.css';

type SiteHeaderProps = {
  onWordmarkActivate: () => void;
};

export const SiteHeader = ({ onWordmarkActivate }: SiteHeaderProps) => (
  <header className="site-header">
    <div className="site-shell site-header__inner">
      <button className="wordmark" type="button" onClick={onWordmarkActivate}>
        Textify
      </button>
      <a className="header-link" href="#how-it-works">
        How it works
      </a>
    </div>
  </header>
);
