// rounds.js — EMBERLINE match/round state machine.
// Pure logic: no DOM, no three.js. First to 8 rounds wins the match.
// Written fresh in the build session (2026-11-17).

const WIN_SCORE = 8;
const ROUND_END_TIME = 4;

export function createRounds() {
  const state = {
    phase: 'menu', // 'menu' | 'buy' | 'live' | 'roundEnd' | 'matchEnd'
    round: 1,
    ember: 0,
    slate: 0,
    timer: 0,
    buyTime: 15,
    roundTime: 100,
    winner: null,
    reason: '',
  };

  let timeUpSent = false;

  const api = {
    state,
    onEvent: () => {},
    startMatch,
    startRound,
    endRound,
    step,
  };

  function startMatch() {
    state.round = 1;
    state.ember = 0;
    state.slate = 0;
    state.winner = null;
    state.reason = '';
    startRound();
    api.onEvent({ type: 'matchStart', round: 1 });
  }

  function startRound() {
    state.phase = 'buy';
    state.timer = state.buyTime;
    timeUpSent = false;
    api.onEvent({ type: 'roundStart', round: state.round });
  }

  function endRound(winnerTeam, reason) {
    if (state.phase === 'matchEnd' || state.phase === 'menu') return;
    if (winnerTeam === 'ember') state.ember++;
    else if (winnerTeam === 'slate') state.slate++;
    state.reason = reason || '';
    state.phase = 'roundEnd';
    state.timer = ROUND_END_TIME;
    if (state.ember >= WIN_SCORE || state.slate >= WIN_SCORE) {
      state.winner = winnerTeam;
    }
    api.onEvent({
      type: 'roundEnd',
      winner: winnerTeam,
      reason: state.reason,
      ember: state.ember,
      slate: state.slate,
      round: state.round,
    });
  }

  function step(dt) {
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.timer = state.roundTime;
        state.phase = 'live';
        api.onEvent({ type: 'buyEnd' });
      }
    } else if (state.phase === 'live') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.timer = 0;
        // Fire once; main.js decides the round winner (defenders win
        // on timeout) and calls endRound.
        if (!timeUpSent) {
          timeUpSent = true;
          api.onEvent({ type: 'timeUp' });
        }
      }
    } else if (state.phase === 'roundEnd') {
      state.timer -= dt;
      if (state.timer <= 0) {
        if (state.winner) {
          state.phase = 'matchEnd';
          state.timer = 0;
          api.onEvent({ type: 'matchEnd', winner: state.winner });
        } else {
          state.round++;
          startRound();
        }
      }
    }
    // 'menu' and 'matchEnd' do not tick.
  }

  return api;
}
