// Unit tests for the heuristic Fit score. `test`/`assert` are globals.
import { fitFromTitle } from '../../functions/_lib/score.js';

test('founders and chiefs score high', () => {
    assert.ok(fitFromTitle('Co-Founder & CEO') >= 90);
    assert.ok(fitFromTitle('CTO') >= 90);
});

test('builders and AI folks score well', () => {
    assert.ok(fitFromTitle('Software Engineer') >= 70);
    assert.ok(fitFromTitle('Machine Learning Engineer') >= 80);
});

test('recruiters and students score low (disqualifiers win)', () => {
    assert.ok(fitFromTitle('Technical Recruiter') <= 30);
    assert.ok(fitFromTitle('Student') <= 30);
});

test('empty/unknown titles get a neutral score', () => {
    assert.equal(fitFromTitle(''), 45);
    assert.equal(fitFromTitle(null), 45);
    assert.equal(fitFromTitle('Wizard'), 50);
});
