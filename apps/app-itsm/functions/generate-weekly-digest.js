// generate-weekly-digest.js - Gather past week KPIs and generate narrative summary

export default async function generateWeeklyDigest(ctx, { db, llm }) {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const startDate = weekAgo.toISOString().slice(0, 10);
    const endDate = today.toISOString().slice(0, 10);

    // Gather KPIs for the past week
    const { rows: kpiRows } = await db.query(
        `SELECT kpi_name, value, dimension, period_date
         FROM kpi_scores
         WHERE period_date >= $1 AND period_date < $2
         ORDER BY period_date, kpi_name`,
        [startDate, endDate]
    );

    // Aggregate weekly stats
    const dailyVolumes = kpiRows.filter((r) => r.kpi_name === 'incident_volume');
    const dailyResolved = kpiRows.filter((r) => r.kpi_name === 'incidents_resolved');
    const dailyMttr = kpiRows.filter((r) => r.kpi_name === 'mttr_minutes');
    const responseCompliance = kpiRows.filter((r) => r.kpi_name === 'sla_response_compliance');
    const resolutionCompliance = kpiRows.filter((r) => r.kpi_name === 'sla_resolution_compliance');
    const reopenRates = kpiRows.filter((r) => r.kpi_name === 'reopen_rate');

    const sum = (arr) => arr.reduce((s, r) => s + parseFloat(r.value), 0);
    const avg = (arr) => arr.length > 0 ? Math.round(sum(arr) / arr.length) : 0;

    const stats = {
        total_created: sum(dailyVolumes),
        total_resolved: sum(dailyResolved),
        avg_mttr_minutes: avg(dailyMttr),
        avg_sla_response: avg(responseCompliance),
        avg_sla_resolution: avg(resolutionCompliance),
        avg_reopen_rate: avg(reopenRates),
    };

    // Get notable incidents from the week
    const { rows: majorIncidents } = await db.query(
        `SELECT number, short_description, priority, state
         FROM incidents
         WHERE is_major = true
           AND created_at >= $1::date AND created_at < $2::date
         ORDER BY priority, created_at DESC
         LIMIT 5`,
        [startDate, endDate]
    );

    const { rows: breachedSlas } = await db.query(
        `SELECT COUNT(*) as count FROM sla_tasks
         WHERE is_breached = true
           AND updated_at >= $1::date AND updated_at < $2::date`,
        [startDate, endDate]
    );

    // Current backlog
    const { rows: [{ count: openCount }] } = await db.query(
        `SELECT COUNT(*) as count FROM incidents WHERE state IN ('new', 'in_progress', 'on_hold')`
    );

    const prompt = `You are an ITSM Operations Manager writing a weekly digest email. Generate a professional HTML summary.

WEEK: ${startDate} to ${endDate}

KEY METRICS:
- Total incidents created: ${stats.total_created}
- Total incidents resolved: ${stats.total_resolved}
- Average MTTR: ${stats.avg_mttr_minutes} minutes
- SLA Response Compliance: ${stats.avg_sla_response}%
- SLA Resolution Compliance: ${stats.avg_sla_resolution}%
- Reopen Rate: ${stats.avg_reopen_rate}%
- SLA Breaches this week: ${parseInt(breachedSlas[0]?.count) || 0}
- Current open backlog: ${parseInt(openCount)}

${majorIncidents.length > 0 ? 'MAJOR INCIDENTS:\n' + majorIncidents.map((i) => `- ${i.number} (P${i.priority}): ${i.short_description} [${i.state}]`).join('\n') : 'No major incidents this week.'}

Generate a concise HTML email body (no <html>/<head>/<body> wrapper, just content) with:
1. Executive summary (2-3 sentences)
2. Key metrics table
3. Highlights and concerns
4. Recommendations for next week

Use simple, inline-styled HTML suitable for email. Keep it professional and data-driven.`;

    const result = await llm({
        messages: [{ role: 'user', content: prompt }],
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
    });

    const digestHtml = result?.choices?.[0]?.message?.content || result?.content || '<p>Unable to generate digest.</p>';

    return {
        period: { start: startDate, end: endDate },
        stats,
        major_incidents: majorIncidents.length,
        sla_breaches: parseInt(breachedSlas[0]?.count) || 0,
        open_backlog: parseInt(openCount),
        digest_html: digestHtml,
    };
}
