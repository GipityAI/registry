// Stepper state machine — pure logic, no DOM. Validates the data-driven
// forward gates: you can't enter Edit/Style/Export until alignment exists.
// Backwards is always free. Auto-advance hook is documented here too.

import { computeStepperStates, unlockedSteps, nextStepAfter, canEnter, STEP_KEYS } from '../src/js/stepper.js';

test('STEP_KEYS lists the 4 wizard steps in order', () => {
  assert.deepEqual(STEP_KEYS, ['upload', 'edit', 'style', 'export']);
});

test('a brand-new song (no alignment) only unlocks Upload', () => {
  assert.deepEqual([...unlockedSteps(null)].sort(), ['upload']);
  assert.deepEqual([...unlockedSteps({})].sort(), ['upload']);
  assert.equal(canEnter(null, 'edit'), false);
  assert.equal(canEnter({}, 'style'), false);
  assert.equal(canEnter({}, 'export'), false);
  assert.equal(canEnter({}, 'upload'), true);
});

test('a song with an alignment unlocks Edit, Style, AND Export', () => {
  // Export is reachable even without a render so the user can see "no renders yet"
  // instead of being blocked behind a locked step.
  const song = { alignment_json: { words: [], phrases: [], metadata: {} } };
  const u = unlockedSteps(song);
  assert.equal(u.has('upload'), true);
  assert.equal(u.has('edit'), true);
  assert.equal(u.has('style'), true);
  assert.equal(u.has('export'), true);
});

test('Upload becomes complete once alignment exists', () => {
  const song = { alignment_json: { words: [] } };
  const states = computeStepperStates(song, 'edit');
  assert.equal(states.upload, 'complete');
});

test('the currently-active step is marked active regardless of completion state', () => {
  const song = { alignment_json: { words: [] }, renders: [{ video_url: 'x' }] };
  // even though upload + edit + style are all "complete" by the
  // hasAlignment/hasRender check, the active step wins.
  const states = computeStepperStates(song, 'upload');
  assert.equal(states.upload, 'active');
});

test('a step that hasn\'t been visited (or has no completion data) reads "available"', () => {
  const song = { alignment_json: { words: [] } };
  const states = computeStepperStates(song, 'edit');
  // Style has no render yet → available, not complete.
  assert.equal(states.style, 'available');
  assert.equal(states.export, 'available');
});

test('Style becomes complete once a render exists', () => {
  const song = {
    alignment_json: { words: [] },
    renders: [{ video_url: 'https://example.com/x.mp4' }],
  };
  const states = computeStepperStates(song, 'upload');
  assert.equal(states.style, 'complete');
  // Edit also marks complete once user has moved past it (proxy: has render).
  assert.equal(states.edit, 'complete');
});

test('Locked steps stay locked, even when active is also locked', () => {
  // Sanity: pass an unreachable active step; locked steps stay locked.
  const states = computeStepperStates(null, 'edit');
  assert.equal(states.edit, 'active');     // active wins
  assert.equal(states.style, 'locked');
  assert.equal(states.export, 'locked');
});

test('a queued/rendering row without a video_url doesn\'t count as a completed render', () => {
  const song = {
    alignment_json: { words: [] },
    renders: [{ status: 'rendering' }],   // no video_url yet
  };
  const states = computeStepperStates(song, 'style');
  assert.equal(states.export, 'available', 'Export should be available but not "complete"');
  assert.equal(states.edit, 'available');
});

test('nextStepAfter(): upload → edit, style → export, anything else → null', () => {
  assert.equal(nextStepAfter('upload'), 'edit');
  assert.equal(nextStepAfter('style'),  'export');
  // Edit and Export don't auto-advance — user drives those.
  assert.equal(nextStepAfter('edit'),   null);
  assert.equal(nextStepAfter('export'), null);
});
