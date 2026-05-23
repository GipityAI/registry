/**
 * Example: live AI agent operations dashboard.
 *
 * Humans and AI agents are both first-class peers. Agents and tasks are
 * server-authoritative entities (data-map backed, persisted, late-join-safe);
 * logs and chat are message streams. The dashboard also reads rt.metrics()
 * via the observability hooks for a live "system health" panel.
 */

import { createRealtime } from '@gipity/realtime';
import { recordAdapter } from '@gipity/realtime/adapters/record-adapter.js';

export async function startAgentOps({ renderAgent, renderTask, appendLog, renderMetrics }) {
  const rt = createRealtime({ room: 'ops-room' });

  const agents = rt.channel('agents', { sync: 'entities', authority: 'server', adapter: recordAdapter });
  const tasks  = rt.channel('tasks',  { sync: 'entities', authority: 'server', adapter: recordAdapter });
  const logs   = rt.channel('logs',   { sync: 'messages' });
  const chat   = rt.channel('chat',   { sync: 'messages' });

  // agent = { id, type:'agent', status, currentTask, progress }
  agents.onUpsert((id, a) => renderAgent(id, a));
  agents.onDelete((id) => renderAgent(id, null));
  // task = { id, type:'task', title, claimedBy, state }
  tasks.onUpsert((id, t) => renderTask(id, t));
  tasks.onDelete((id) => renderTask(id, null));
  logs.on('line', (l) => appendLog(l));

  // Observability: a live health panel, no extra plumbing.
  rt.onMetrics((m) => renderMetrics(m), 1000);

  await rt.connect();

  return {
    // an agent (human or AI) publishes its own state
    updateAgent: (a) => agents.upsert(a.id, a),
    // claim a job: optimistic upsert, server data map reconciles
    claimTask: (taskId, agentId) => {
      const t = tasks.get(taskId);
      if (t) tasks.upsert(taskId, { ...t, claimedBy: agentId, state: 'in-progress' });
    },
    log: (line) => logs.send('line', line),
    say: (text, from) => chat.send('line', { from, text }),
    rt,
  };
}
