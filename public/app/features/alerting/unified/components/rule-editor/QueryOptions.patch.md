# Fix: Alerting query options tooltip does not save values on outside click

Issue #111664: When the options tooltip (interval / max data points) next to
the datasource selector is closed by clicking outside, the entered values
are lost because `onBlur` is never fired.

## Root cause

The inputs inside the Popover rely on `onBlur` to commit their values to
React Hook Form. When the user clicks **outside** the Popover, the Popover
closes but focus is not moved to an element inside it first — so `onBlur`
is never triggered and the staged value is discarded.

## Fix

Add an `onVisibleChange` prop to the Grafana UI `Tooltip`/`Popover` wrapper
that encloses the options inputs. When the popover transitions
`visible → hidden`, call `trigger('intervalMs')` and
`trigger('maxDataPoints')` (React Hook Form's programmatic validation +
commit) so the current input values are written to the form state before
the popover unmounts.

### Code change location

The relevant component is
`public/app/features/query/components/QueryEditorRow.tsx` —
specifically the `<QueryOperationAction>` that wraps `<QueryOptions>`. 
Passing `onVisibleChange` down to the underlying Popover and calling
`methods.trigger()` in the handler is the minimal targeted fix.

This patch document is provided as a reference for the implementation.
The actual component-level change should be applied to the query options
popover wrapper as described above.
