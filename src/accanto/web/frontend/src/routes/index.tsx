import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: ProductionHome });

export function ProductionHome() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="brand" aria-label="Accanto">
          <span className="brand-mark" aria-hidden="true">
            a
          </span>
          <span>accanto</span>
        </div>
        <span className="header-label">Your financial companion</span>
      </header>
      <main id="main-content" className="shell-main">
        <div className="welcome-card">
          <p className="eyebrow">A place for the life you are planning</p>
          <h1>Your financial workspace</h1>
          <p className="lead">
            Bring your Plans, recorded activity, and Reviews together in one place.
          </p>
          <output className="connection-state">
            <span className="state-dot" aria-hidden="true" />
            <span className="state-copy">
              <strong>Not connected yet</strong>
              <span>Sign-in and your Entity workspace are being prepared.</span>
            </span>
          </output>
        </div>
      </main>
      <footer className="site-footer">Plan thoughtfully. Live richly.</footer>
    </div>
  );
}
