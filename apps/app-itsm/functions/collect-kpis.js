// collect-kpis.js - Calculate yesterday's ITSM KPIs and insert into kpi_scores

export default async function collectKpis(ctx, { db }) {
    // Calculate for yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const periodDate = yesterday.toISOString().slice(0, 10);

    const kpis = [];

    // 1. Incident volume (created yesterday)
    const { rows: [{ count: volume }] } = await db.query(
        `SELECT COUNT(*) as count FROM incidents
         WHERE created_at >= $1::date AND created_at < ($1::date + interval '1 day')`,
        [periodDate]
    );
    kpis.push({ kpi_name: 'incident_volume', value: parseInt(volume), dimension: 'daily' });

    // 2. Incidents resolved (yesterday)
    const { rows: [{ count: resolved }] } = await db.query(
        `SELECT COUNT(*) as count FROM incidents
         WHERE resolved_at >= $1::date AND resolved_at < ($1::date + interval '1 day')`,
        [periodDate]
    );
    kpis.push({ kpi_name: 'incidents_resolved', value: parseInt(resolved), dimension: 'daily' });

    // 3. MTTR (mean time to resolve) in minutes for incidents resolved yesterday
    const { rows: [{ avg_mttr }] } = await db.query(
        `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60), 0) as avg_mttr
         FROM incidents
         WHERE resolved_at >= $1::date AND resolved_at < ($1::date + interval '1 day')
           AND resolved_at IS NOT NULL`,
        [periodDate]
    );
    kpis.push({ kpi_name: 'mttr_minutes', value: Math.round(parseFloat(avg_mttr) || 0), dimension: 'daily' });

    // 4. SLA response compliance (% of response SLAs met yesterday)
    const { rows: [slaResponse] } = await db.query(
        `SELECT
            COUNT(*) FILTER (WHERE NOT st.is_breached) as met,
            COUNT(*) as total
         FROM sla_tasks st
         JOIN sla_definitions sd ON st.sla_definition_id = sd.id
         WHERE sd.target_type = 'response'
           AND st.end_time >= $1::date AND st.end_time < ($1::date + interval '1 day')`,
        [periodDate]
    );
    const responseCompliance = slaResponse.total > 0
        ? Math.round((parseInt(slaResponse.met) / parseInt(slaResponse.total)) * 100)
        : 100;
    kpis.push({ kpi_name: 'sla_response_compliance', value: responseCompliance, dimension: 'daily' });

    // 5. SLA resolution compliance
    const { rows: [slaResolution] } = await db.query(
        `SELECT
            COUNT(*) FILTER (WHERE NOT st.is_breached) as met,
            COUNT(*) as total
         FROM sla_tasks st
         JOIN sla_definitions sd ON st.sla_definition_id = sd.id
         WHERE sd.target_type = 'resolution'
           AND st.end_time >= $1::date AND st.end_time < ($1::date + interval '1 day')`,
        [periodDate]
    );
    const resolutionCompliance = slaResolution.total > 0
        ? Math.round((parseInt(slaResolution.met) / parseInt(slaResolution.total)) * 100)
        : 100;
    kpis.push({ kpi_name: 'sla_resolution_compliance', value: resolutionCompliance, dimension: 'daily' });

    // 6. Open by priority (snapshot)
    const { rows: priorityCounts } = await db.query(
        `SELECT priority, COUNT(*) as count FROM incidents
         WHERE state IN ('new', 'in_progress', 'on_hold')
         GROUP BY priority ORDER BY priority`
    );
    for (const row of priorityCounts) {
        kpis.push({
            kpi_name: 'open_by_priority',
            value: parseInt(row.count),
            dimension: `P${row.priority}`,
        });
    }

    // 7. Reopen rate (yesterday)
    const { rows: [reopenData] } = await db.query(
        `SELECT
            COUNT(*) FILTER (WHERE reopen_count > 0) as reopened,
            COUNT(*) as total
         FROM incidents
         WHERE resolved_at >= $1::date AND resolved_at < ($1::date + interval '1 day')`,
        [periodDate]
    );
    const reopenRate = reopenData.total > 0
        ? Math.round((parseInt(reopenData.reopened) / parseInt(reopenData.total)) * 100)
        : 0;
    kpis.push({ kpi_name: 'reopen_rate', value: reopenRate, dimension: 'daily' });

    // Bulk insert all KPIs
    for (const kpi of kpis) {
        await db.query(
            `INSERT INTO kpi_scores (kpi_name, value, dimension, period_date)
             VALUES ($1, $2, $3, $4)`,
            [kpi.kpi_name, kpi.value, kpi.dimension, periodDate]
        );
    }

    return {
        period_date: periodDate,
        kpis_collected: kpis.length,
        summary: {
            incident_volume: parseInt(volume),
            incidents_resolved: parseInt(resolved),
            mttr_minutes: Math.round(parseFloat(avg_mttr) || 0),
            sla_response_compliance: responseCompliance,
            sla_resolution_compliance: resolutionCompliance,
            reopen_rate: reopenRate,
        },
    };
}
