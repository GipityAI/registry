// calculate-sla.js - Calculate SLA targets and create SLA task records

export default async function calculateSla(ctx, { db }) {
    const { incident_id } = ctx.body;
    // Load incident
    const { rows: [incident] } = await db.query(
        `SELECT id, priority, created_at FROM incidents WHERE id = $1`,
        [incident_id]
    );
    if (!incident) {
        return { error: 'Incident not found' };
    }

    // Find matching SLA definitions for this priority
    const { rows: slaDefs } = await db.query(
        `SELECT sd.*, bc.name as calendar_name, bc.schedule, bc.holidays, bc.timezone
         FROM sla_definitions sd
         LEFT JOIN business_calendars bc ON sd.calendar_id = bc.id
         WHERE sd.condition_priority = $1 AND sd.is_active = true AND sd.target_table = 'incidents'`,
        [incident.priority]
    );

    if (slaDefs.length === 0) {
        return { incident_id, sla_tasks_created: 0, message: 'No SLA definitions for this priority' };
    }

    const tasksCreated = [];
    const startTime = new Date(incident.created_at);

    for (const def of slaDefs) {
        const targetTime = calculateTargetTime(startTime, def.target_minutes, def.schedule, def.holidays, def.timezone);

        const { rows: [task] } = await db.query(
            `INSERT INTO sla_tasks (sla_definition_id, incident_id, start_time, target_time, state)
             VALUES ($1, $2, $3, $4, 'in_progress')
             RETURNING id, target_time`,
            [def.id, incident_id, startTime, targetTime]
        );

        tasksCreated.push({
            id: task.id,
            type: def.target_type,
            target_minutes: def.target_minutes,
            target_time: task.target_time,
            calendar: def.calendar_name,
        });
    }

    // Update incident SLA due dates
    const responseSla = tasksCreated.find((t) => t.type === 'response');
    const resolutionSla = tasksCreated.find((t) => t.type === 'resolution');

    await db.query(
        `UPDATE incidents SET
            sla_response_due = $1,
            sla_resolution_due = $2,
            updated_at = NOW()
         WHERE id = $3`,
        [
            responseSla?.target_time || null,
            resolutionSla?.target_time || null,
            incident_id,
        ]
    );

    return {
        incident_id,
        priority: incident.priority,
        sla_tasks_created: tasksCreated.length,
        tasks: tasksCreated,
    };
}

/**
 * Calculate the target time given a start time, minutes, and business calendar.
 */
function calculateTargetTime(startTime, targetMinutes, schedule, holidays, timezone) {
    // "always" schedule = 24x7, simple minute addition
    if (schedule === 'always' || schedule === '"always"') {
        return new Date(startTime.getTime() + targetMinutes * 60 * 1000);
    }

    // Business hours calculation
    const cal = typeof schedule === 'string' ? JSON.parse(schedule) : schedule;
    const holidayList = typeof holidays === 'string' ? JSON.parse(holidays) : (holidays || []);
    const holidayDates = new Set(holidayList.map((h) => h.date));

    let remainingMinutes = targetMinutes;
    let current = new Date(startTime);

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const MAX_ITERATIONS = 365 * 24; // Safety limit

    for (let i = 0; i < MAX_ITERATIONS && remainingMinutes > 0; i++) {
        const dayName = dayNames[current.getDay()];
        const daySchedule = cal[dayName];
        const dateStr = current.toISOString().slice(0, 10);

        // Skip holidays and non-working days
        if (!daySchedule || holidayDates.has(dateStr)) {
            // Advance to next day start
            current = new Date(current);
            current.setDate(current.getDate() + 1);
            current.setHours(0, 0, 0, 0);
            continue;
        }

        // Parse business hours
        const [startH, startM] = daySchedule.start.split(':').map(Number);
        const [endH, endM] = daySchedule.end.split(':').map(Number);
        const dayStart = new Date(current);
        dayStart.setHours(startH, startM, 0, 0);
        const dayEnd = new Date(current);
        dayEnd.setHours(endH, endM, 0, 0);

        // If current time is before business hours start, advance to start
        if (current < dayStart) {
            current = new Date(dayStart);
        }

        // If current time is after business hours end, advance to next day
        if (current >= dayEnd) {
            current.setDate(current.getDate() + 1);
            current.setHours(0, 0, 0, 0);
            continue;
        }

        // Calculate available minutes in this business day
        const availableMs = dayEnd.getTime() - current.getTime();
        const availableMinutes = availableMs / (60 * 1000);

        if (remainingMinutes <= availableMinutes) {
            // Target falls within this business day
            return new Date(current.getTime() + remainingMinutes * 60 * 1000);
        }

        // Consume this day's minutes and move to next day
        remainingMinutes -= availableMinutes;
        current = new Date(dayEnd);
        current.setDate(current.getDate() + 1);
        current.setHours(0, 0, 0, 0);
    }

    // Fallback: if we somehow exhaust iterations, just add raw minutes
    return new Date(startTime.getTime() + targetMinutes * 60 * 1000);
}
