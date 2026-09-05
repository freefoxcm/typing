export type GameId = 'super-mario' | 'kart-racer'
export const games: Record<GameId, { name: string; description: string; icon: string }> = {
  'super-mario': { name: '星光冒险', description: '越过山丘，收集星光，探索十二段奇遇。', icon: '✦' },
  'kart-racer': { name: '卡丁赛车', description: '选择赛道，漂移过弯，奔向终点。', icon: '⚑' },
}
export type RewardSettings = {
  enabled: boolean; duration_minutes: number; mode: 'score' | 'random'; adventure_threshold: number
  racer_threshold: number; random_threshold: number; minimum_questions: number
}
export type Reward = {
  id: number; child_id: number; source_session_id: number | null; reward_date: string; games: GameId[]
  status: 'available' | 'started'; display_version: number; duration_minutes: number; mode: 'score' | 'random'
  play: { id: number; game_id: GameId; started_at: string; expires_at: string } | null
}
export type RewardResponse = { reward: Reward | null; server_now: string }
