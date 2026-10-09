# Web UI

React/Vite SPA packaged as an independent deployable.

- Container port: `80`
- Data ownership: none
- Public entry: Nginx `/`
- API boundary: `/api/v1/*` through Gateway

The browser never addresses an internal domain service directly. Screen reads use Composite Views; mutations use domain endpoints through the Gateway. TanStack Query owns client cache/revalidation state.
