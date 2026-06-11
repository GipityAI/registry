# @gipity/views — registry-driven UI for the records kit

Generic screens that render entirely from the field registry — zero per-object
UI code. Requires the `records` kit.

```js
// NOTE: bare '@gipity/views/...' imports resolve only on pages whose HTML has
// the import map (the installer patches src/index.html). On other pages of a
// multi-page app, use relative imports: '../packages/views/table.js'.
import { renderTable } from '../packages/views/table.js';
import { renderKanban } from '../packages/views/kanban.js';
import { openRecordForm } from '../packages/views/form.js';
import { formatValue } from '../packages/views/fields.js';
import { getSchema } from '../packages/records/api.js';

const { objects } = await getSchema('myapp');
const object = objects.find(o => o.name === 'asset');

// Table: search, per-select-field filters, click-to-sort, dense rows.
// `initial` pre-applies a saved view's {q, filters, sort}; getState() reads it back.
const table = renderTable({
  mount, object, initial: {},
  onRowClick: r => openDetail(r),
  editable: () => !!user,   // double-click a cell to edit in place; concurrent
});                         // edits come back as a clean conflict error

// Kanban: columns from any select field; drag-to-update flows through record-write.
renderKanban({ mount, object, groupField: 'status', cardFields: ['price'], metricField: 'price', canEdit: () => !!user });

// Form: create/edit/delete dialog with type-appropriate widgets. Relation fields
// render a debounced typeahead that searches the target object server-side (no
// preloading), so they scale past a few hundred records; composites edit their
// primary value. Inline cell editing covers scalar types - relations edit in the form.
openRecordForm({ object, record, onSaved: (rec) => table.refresh() });
```

Include the stylesheet: `<link rel="stylesheet" href="./packages/views/views.css">`.
The kit's CSS is deliberately minimal — set density/branding in your app's own
stylesheet by overriding `.kit-table`, `.kit-card`, etc.

`readtable.js` renders a read-only table over any `{label, columns, rows}`
payload (for SQL-view reports / introspection-style endpoints).

Saved views: persist `table.getState()` as a record of your own (the GipCRM
reference app uses a `saved_view` object whose `config` field holds it) and
pass it back as `initial`.
