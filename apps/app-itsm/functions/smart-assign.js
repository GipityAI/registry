// smart-assign.js - Intelligent incident assignment based on workload + expertise

export default async function smartAssign(ctx, { db }) {
    const { incident_id, team_id } = ctx.body;
    // Get team members
    const { rows: members } = await db.query(
        `SELECT tm.user_id, up.display_name
         FROM team_members tm
         LEFT JOIN user_profiles up ON tm.user_id = up.gipity_user_id
         WHERE tm.team_id = $1`,
        [team_id]
    );

    if (members.length === 0) {
        return { assigned: false, reason: 'No team members found' };
    }

    // Get the incident's category for expertise matching
    const { rows: [incident] } = await db.query(
        `SELECT category_id, subcategory_id FROM incidents WHERE id = $1`,
        [incident_id]
    );

    const scores = [];

    for (const member of members) {
        // Current open incident count (workload)
        const { rows: [{ count: openCount }] } = await db.query(
            `SELECT COUNT(*) as count FROM incidents
             WHERE assigned_to = $1 AND state IN ('new', 'in_progress', 'on_hold')`,
            [member.user_id]
        );

        // Category expertise: count of resolved incidents in this category
        let expertiseCount = 0;
        if (incident?.category_id) {
            const { rows: [{ count }] } = await db.query(
                `SELECT COUNT(*) as count FROM incidents
                 WHERE assigned_to = $1 AND state IN ('resolved', 'closed')
                   AND (category_id = $2 OR subcategory_id = $3)`,
                [member.user_id, incident.category_id, incident.subcategory_id || incident.category_id]
            );
            expertiseCount = parseInt(count) || 0;
        }

        // Score: lower workload is better, higher expertise is better
        // Normalize: workload 0-20 → 1.0-0.0, expertise 0+ → 0.0-1.0 (log scale)
        const workloadScore = Math.max(0, 1 - (parseInt(openCount) / 20));
        const expertiseScore = Math.min(1, Math.log2(expertiseCount + 1) / 5);

        // Weighted: workload 60%, expertise 40%
        const WORKLOAD_WEIGHT = 0.6;
        const EXPERTISE_WEIGHT = 0.4;
        const totalScore = (workloadScore * WORKLOAD_WEIGHT) + (expertiseScore * EXPERTISE_WEIGHT);

        scores.push({
            user_id: member.user_id,
            display_name: member.display_name,
            open_incidents: parseInt(openCount),
            resolved_in_category: expertiseCount,
            workload_score: Math.round(workloadScore * 100) / 100,
            expertise_score: Math.round(expertiseScore * 100) / 100,
            total_score: Math.round(totalScore * 100) / 100,
        });
    }

    // Sort by total score descending
    scores.sort((a, b) => b.total_score - a.total_score);
    const bestMatch = scores[0];

    // Assign the incident
    await db.query(
        `UPDATE incidents SET assigned_to = $1, updated_at = NOW() WHERE id = $2`,
        [bestMatch.user_id, incident_id]
    );

    return {
        assigned: true,
        assigned_to: bestMatch.user_id,
        assigned_name: bestMatch.display_name,
        score: bestMatch.total_score,
        candidates: scores,
    };
}
