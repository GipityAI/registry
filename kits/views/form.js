// views kit - form view in a <dialog>. Create + edit + delete, registry-driven.
// Sealed kit: no app imports.
import { createRecord, updateRecord, deleteRecord } from '../records/api.js';
import { buildWidget } from './fields.js';

export function openRecordForm({ object, record = null, onSaved, onDeleted }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'kit-form';
  const isEdit = !!record;

  const h = document.createElement('h3');
  h.textContent = isEdit
    ? `Edit ${object.label}: ${record[object.title_field] || record.id}`
    : `New ${object.label}`;
  dialog.appendChild(h);

  const errBox = document.createElement('p');
  errBox.className = 'kit-error';
  errBox.hidden = true;
  dialog.appendChild(errBox);

  const form = document.createElement('form');
  form.method = 'dialog';
  const readers = [];
  for (const f of object.fields) {
    const { wrapper, read } = buildWidget(f, record?.[f.name]);
    readers.push([f.name, read]);
    form.appendChild(wrapper);
  }

  const actions = document.createElement('div');
  actions.className = 'kit-form-actions';
  const save = button(isEdit ? 'Save' : 'Create', 'submit');
  const cancel = button('Cancel', 'button');
  cancel.addEventListener('click', () => dialog.close());
  actions.appendChild(save);
  actions.appendChild(cancel);

  if (isEdit) {
    const del = button('Delete', 'button');
    del.className = 'kit-danger';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete ${object.label.toLowerCase()} "${record[object.title_field]}"? (Soft-deleted; recoverable.)`)) return;
      try {
        await deleteRecord(object.name, record.id);
        dialog.close();
        onDeleted?.();
      } catch (err) { showError(err); }
    });
    actions.appendChild(del);
  }
  form.appendChild(actions);
  dialog.appendChild(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(readers.map(([name, read]) => [name, read()]));
    try {
      const result = isEdit
        ? await updateRecord(object.name, record.id, values)
        : await createRecord(object.name, values);
      dialog.close();
      onSaved?.(result.record);
    } catch (err) { showError(err); }
  });

  function showError(err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  }

  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
  return dialog;
}

function button(label, type) {
  const b = document.createElement('button');
  b.type = type;
  b.textContent = label;
  return b;
}
