export const MAX_PLAYER_BOARDS = 1024;
export const WARN_PLAYER_BOARDS = 512;
export function playerBoardError(rounds: number, boardsPerRound: number) {
  return rounds * boardsPerRound > MAX_PLAYER_BOARDS
    ? '每位賽員最多 1024 副（圈數 × 每圈牌數，輪空也計入）。' : null;
}
export function playerBoardWarning(rounds: number, boardsPerRound: number) {
  const total = rounds * boardsPerRound;
  return total > WARN_PLAYER_BOARDS && total <= MAX_PLAYER_BOARDS
    ? `注意：每位賽員安排 ${total} 副，已超過 512 副（輪空也計入），請確認賽程長度。` : null;
}
