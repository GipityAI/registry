// views kit - kanban/board view. Columns come from a select field's options;
// drag-to-update flows through the records kit write path (never raw SQL),
// so every drop lands on the event spine. Sealed kit: no app imports.
import { listRecords, updateRecord } from '../records/api.js';
import { formatValue, prettyLabel } from './fields.js';

// `metricField` (a currency field) adds a per-column total next to the count -
// the pipeline-metrics bar falls out of the registry for free.
export function renderKanban({ mount, object, groupField, cardFields = [], metricField, onCardClick, canEdit = () => true }) {
  const group = object.fields.find(f => f.name === groupField);
  if (!group || group.type !== 'select') {
    throw new Error(`Kanban needs a select field to group by; '${groupField}' is not one on ${object.name}.`);
  }
  const extras = object.fields.filter(f => cardFields.includes(f.name));
  const state = { records: [] };

  mount.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'kit-board';
  mount.appendChild(board);

  async function refresh() {
    const { records } = await listRecords(object.name, { limit: 200 });
    state.records = records;
    draw();
  }

  function draw() {
    board.innerHTML = '';
    for (const value of group.options?.values || []) {
      const records = state.records.filter(r => r[group.name] === value);
      const col = document.createElement('section');
      col.className = 'kit-column';
      col.dataset.value = value;

      const head = document.createElement('header');
      head.textContent = `${prettyLabel(value)} `;
      const n = document.createElement('span');
      n.className = 'kit-count';
      n.textContent = records.length;
      if (metricField) {
        const micros = records.reduce((t, r) => t + (Number(r[metricField]?.amountMicros) || 0), 0);
        if (micros > 0) {
          n.textContent += ` · ${(micros / 1_000_000).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`;
        }
      }
      head.appendChild(n);
      col.appendChild(head);

      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('kit-drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('kit-drop'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('kit-drop');
        const id = e.dataTransfer.getData('text/plain');
        const rec = state.records.find(r => r.id === id);
        if (!rec || rec[group.name] === value) return;
        try {
          await updateRecord(object.name, id, { [group.name]: value });
          await refresh();
        } catch (err) {
          alert(err.message);
        }
      });

      for (const rec of records) {
        col.appendChild(card(rec));
      }
      board.appendChild(col);
    }
  }

  function card(rec) {
    const el = document.createElement('article');
    el.className = 'kit-card';
    el.draggable = canEdit();
    el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', rec.id));
    el.addEventListener('click', () => onCardClick?.(rec));

    const title = document.createElement('strong');
    title.textContent = rec[object.title_field] || rec.id;
    el.appendChild(title);

    for (const f of extras) {
      const line = document.createElement('div');
      line.className = 'kit-card-line';
      line.textContent = formatValue(f, rec[f.name]);
      el.appendChild(line);
    }
    return el;
  }

  refresh();
  return { refresh };
}
