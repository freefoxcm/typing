export type Me = { role: 'admin' | 'child'; name: string; actor_id: number }
export type Child = { id: number; name: string; active?: boolean; attempts?: number; created_at?: string }
export type Prompt = { id: number; lesson_id?: number; content: string; sort_order?: number; active?: boolean }
export type Lesson = {
  id: number
  course_id?: number
  title: string
  description: string
  sort_order?: number
  active?: boolean
  prompt_count?: number
  best_cpm?: number | null
  best_accuracy?: number | null
  attempts?: number
  prompts?: Prompt[]
}
export type Course = {
  id: number
  title: string
  description: string
  sort_order?: number
  active?: boolean
  lessons: Lesson[]
}
export type LessonDetail = {
  id: number
  title: string
  description: string
  course: { id: number; title: string }
  prompts: Prompt[]
}
export type ErrorCount = { expected_char: string; actual_char: string; count: number }
export type AttemptResult = { id: number; cpm: number; accuracy: number; errors: number; duration_ms: number }
export type Report = {
  attempt_count: number
  practice_minutes: number
  average_cpm: number
  accuracy: number
  weak_keys: { char: string; count: number }[]
  attempts: { id: number; child_id: number; lesson_id: number | null; cpm: number; accuracy: number; errors: number; duration_ms: number; created_at: string }[]
}

