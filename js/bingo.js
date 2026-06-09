export function initBingoModule({ state, role }) {
  const currentState = state.getState();
  const bingoState = {
    initialized: true,
    role,
    lastUpdatedAt: null,
  };

  state.patch({
    bingo: {
      ...currentState.bingo,
      ...bingoState,
    },
  });
}
