export function initTriviaModule({ state, role }) {
  const currentState = state.getState();
  const triviaState = {
    initialized: true,
    role,
    lastUpdatedAt: null,
  };

  state.patch({
    trivia: {
      ...currentState.trivia,
      ...triviaState,
    },
  });
}
