// check-sla-breaches.js - Check for SLA breaches and warnings

export default async function checkSlaBreaches(ctx, { db }) {
    const now = new Date();
    const results = { breached: [], warnings: [], total_checked: 0 };

    // Find breached SLA tasks (target_time has passed, not already breached)
    const { rows: breachedTasks } = await db.query(
        `SELECT st.id, st.incident_id, st.target_time, st.sla_definition_id,
                sd.target_type, sd.name as sla_name,
                i.number as incident_number, i.short_description
         FROM sla_tasks st
         JOIN sla_definitions sd ON st.sla_definition_id = sd.id
         JOIN incidents i ON st.incident_id = i.id
         WHERE st.state = 'in_progress'
           AND st.is_breached = false
           AND st.target_time < NOW()`
    );

    // Mark breached tasks
    for (const task of breachedTasks) {
        await db.query(
            `UPDATE sla_tasks SET
                is_breached = true,
                percentage = 100,
                updated_at = NOW()
             WHERE id = $1`,
            [task.id]
        );

        // Update parent incident breach flags
        if (task.target_type === 'response') {
            await db.query(
                `UPDATE incidents SET sla_response_breached = true, updated_at = NOW() WHERE id = $1`,
                [task.incident_id]
            );
        } else if (task.target_type === 'resolution') {
            await db.query(
                `UPDATE incidents SET sla_resolution_breached = true, updated_at = NOW() WHERE id = $1`,
                [task.incident_id]
            );
        }

        // Add work note to incident
        await db.query(
            `INSERT INTO comments (target_table, target_id, comment_type, body, author_name, is_ai_generated)
             VALUES ('incidents', $1, 'work_note', $2, 'SLA Monitor', true)`,
            [task.incident_id, `SLA BREACHED: ${task.sla_name} target of ${task.target_time.toISOString()} has been exceeded.`]
        );

        results.breached.push({
            sla_task_id: task.id,
            incident_number: task.incident_number,
            sla_name: task.sla_name,
            target_time: task.target_time,
        });
    }

    // Find tasks at >75% elapsed (warning zone)
    const { rows: activeTasks } = await db.query(
        `SELECT st.id, st.incident_id, st.start_time, st.target_time, st.percentage,
                st.paused_duration_minutes,
                sd.target_type, sd.name as sla_name,
                i.number as incident_number
         FROM sla_tasks st
         JOIN sla_definitions sd ON st.sla_definition_id = sd.id
         JOIN incidents i ON st.incident_id = i.id
         WHERE st.state = 'in_progress'
           AND st.is_breached = false`
    );

    for (const task of activeTasks) {
        const startMs = new Date(task.start_time).getTime();
        const targetMs = new Date(task.target_time).getTime();
        const totalMs = targetMs - startMs;
        const pausedMs = (task.paused_duration_minutes || 0) * 60 * 1000;
        const elapsedMs = now.getTime() - startMs - pausedMs;
        const percentage = Math.min(100, Math.round((elapsedMs / totalMs) * 100));

        // Update percentage
        await db.query(
            `UPDATE sla_tasks SET percentage = $1, updated_at = NOW() WHERE id = $2`,
            [percentage, task.id]
        );

        if (percentage >= 75 && task.percentage < 75) {
            // Just crossed the 75% threshold - add warning
            await db.query(
                `INSERT INTO comments (target_table, target_id, comment_type, body, author_name, is_ai_generated)
                 VALUES ('incidents', $1, 'work_note', $2, 'SLA Monitor', true)`,
                [task.incident_id, `SLA WARNING: ${task.sla_name} is at ${percentage}% of target time. Target: ${task.target_time.toISOString()}`]
            );

            results.warnings.push({
                sla_task_id: task.id,
                incident_number: task.incident_number,
                sla_name: task.sla_name,
                percentage,
            });
        }

        results.total_checked++;
    }

    return results;
}
