# Firefox 66 Compatibility

Firefox 66 support is handled as progressive enhancement.

Core workflows must remain usable with server-rendered HTML, native links,
native form posts, and browser controls such as `details`/`summary`. React
client components may enhance those workflows, but must not be the only way to
view, edit, submit, approve, or reset critical records.

The `browserslist` entry in `package.json` is a best-effort browser target for
tooling. It is not a complete compatibility guarantee because older browsers can
fail while parsing modern JavaScript before polyfills run.

When adding dynamic UI:

- Use query params for selected rows, edit modes, expanded sections, filters,
  result messages, and active tabs.
- Use route handlers for non-JavaScript POST workflows.
- Include hidden inputs for record ids and return state.
- Use native controls for required interactions, then layer React behavior on
  top.
- Avoid making `onClick`/`onChange` handlers the only path to complete a core
  workflow.
