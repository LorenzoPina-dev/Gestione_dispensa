# Web application

Next.js PWA shell for family workflows. Routes, UI components, and browser adapters belong here.
The web app consumes versioned contracts and never accesses PostgreSQL directly.

The shell model keeps loading, retrying, offline and error states explicit, scopes navigation to
family workflows, and rejects unsafe external redirect targets. A framework adapter can render this
model with accessible landmarks and keyboard-focusable links without coupling the browser to service
internals.
