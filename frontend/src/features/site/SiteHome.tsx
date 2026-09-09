import './site.css'
import heroImage from '../../assets/hero.png'

interface ArrowIconProps {
  direction?: 'right' | 'down'
}

function ArrowIcon({ direction = 'right' }: ArrowIconProps) {
  return (
    <svg
      className={`site-arrow site-arrow-${direction}`}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path d={direction === 'down' ? 'M10 3v12m0 0 4-4m-4 4-4-4' : 'M3 10h13m0 0-4-4m4 4-4 4'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SiteMark() {
  return (
    <span className="site-mark" aria-hidden="true">
      <span />
    </span>
  )
}

function SiteHome() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="site-brand" href="#" aria-label="Roomform home">
          <SiteMark />
          <span>Roomform</span>
        </a>

        <nav className="site-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#room-designer">Room Designer</a>
          <a className="site-nav-cta" href="#room-designer">
            Scan your room
            <ArrowIcon />
          </a>
        </nav>
      </header>

      <main>
        <section className="site-hero" aria-labelledby="site-hero-title">
          <div className="site-hero-copy">
            <p className="site-kicker"><span className="site-kicker-dot" /> Spatial planning for real rooms</p>
            <h1 id="site-hero-title">Make your next room <em>fit</em> before you build it.</h1>
            <p className="site-hero-description">
              Roomform turns a quick walk around your space into a measured starting point for confident design decisions.
            </p>
            <div className="site-hero-actions">
              <a className="site-button site-button-primary" href="#room-designer">
                Start your room scan
                <ArrowIcon />
              </a>
              <a className="site-text-link" href="#how-it-works">
                See the process
                <ArrowIcon />
              </a>
            </div>
            <p className="site-hero-note">Works in your browser on supported AR devices.</p>
          </div>

          <div className="site-hero-art" aria-label="Abstract measured room model illustration" role="img">
            <div className="site-art-glow" />
            <div className="site-art-grid" />
            <div className="site-art-ring site-art-ring-back" />
            <div className="site-art-ring site-art-ring-front" />
            <img src={heroImage} alt="" />
            <div className="site-art-label site-art-label-top">
              <span>Capture</span>
              <strong>01</strong>
            </div>
            <div className="site-art-label site-art-label-bottom">
              <span className="site-label-pulse" />
              <span>Measured in place</span>
            </div>
          </div>
        </section>

        <section className="site-proof-row" aria-label="Roomform principles">
          <div><strong>01</strong><span>Real spaces, first</span></div>
          <div><strong>02</strong><span>Measured, not guessed</span></div>
          <div><strong>03</strong><span>Decisions you can see</span></div>
        </section>

        <section className="site-process" id="how-it-works" aria-labelledby="process-title">
          <div className="site-section-intro">
            <p className="site-kicker">A clearer way forward</p>
            <h2 id="process-title">From empty room to <em>next move.</em></h2>
            <p>One simple capture sets up the measured foundation for everything you want to decide next.</p>
          </div>

          <div className="site-process-grid">
            <article className="site-process-card site-process-card-featured">
              <span className="site-process-number">01</span>
              <span className="site-process-icon site-process-icon-scan" aria-hidden="true"><span /></span>
              <h3>Scan your room</h3>
              <p>Move slowly through the space while your phone records the surfaces around you.</p>
              <a href="#room-designer">Open the scanner <ArrowIcon /></a>
            </article>
            <article className="site-process-card">
              <span className="site-process-number">02</span>
              <span className="site-process-icon site-process-icon-measure" aria-hidden="true"><span /><span /></span>
              <h3>Get a measured 3D representation</h3>
              <p>Your captured observations become a useful spatial reference for planning.</p>
            </article>
            <article className="site-process-card">
              <span className="site-process-number">03</span>
              <span className="site-process-icon site-process-icon-material" aria-hidden="true"><span /></span>
              <h3>Choose materials</h3>
              <p>Explore finishes and materials against the proportions of your own room.</p>
            </article>
            <article className="site-process-card">
              <span className="site-process-number">04</span>
              <span className="site-process-icon site-process-icon-preview" aria-hidden="true"><span /></span>
              <h3>Preview in your space</h3>
              <p>See the direction before the first delivery, cut, or coat of paint.</p>
            </article>
          </div>
        </section>

        <section className="site-designer-callout" aria-labelledby="designer-callout-title">
          <div className="site-callout-mark" aria-hidden="true"><span /><span /><span /></div>
          <div className="site-callout-copy">
            <p className="site-kicker">Room Designer</p>
            <h2 id="designer-callout-title">Start with the room you already have.</h2>
            <p className="site-callout-description">
              Scan a room now to create its measured 3D representation. Material selection and in-space previews are the next step in the Roomform flow.
            </p>
            <p className="site-callout-flow" aria-label="Room Designer flow">
              <span>Scan room</span>
              <b aria-hidden="true">→</b>
              <span>measured 3D representation</span>
              <b aria-hidden="true">→</b>
              <span>choose materials</span>
              <b aria-hidden="true">→</b>
              <span>preview in your space</span>
            </p>
          </div>
          <a className="site-button site-button-light" href="#room-designer">
            Launch Room Designer
            <ArrowIcon />
          </a>
        </section>

        <section className="site-final-cta" aria-labelledby="final-cta-title">
          <p className="site-kicker">See what fits</p>
          <h2 id="final-cta-title">Your room is the starting point.</h2>
          <a className="site-button site-button-primary" href="#room-designer">
            Start scanning
            <ArrowIcon />
          </a>
        </section>
      </main>

      <footer className="site-footer">
        <a className="site-brand" href="#" aria-label="Roomform home">
          <SiteMark />
          <span>Roomform</span>
        </a>
        <span>Spatial planning for rooms in progress.</span>
      </footer>

      <a className="site-mobile-cta" href="#room-designer">
        <span>Open Room Designer</span>
        <ArrowIcon />
      </a>
    </div>
  )
}

export default SiteHome
