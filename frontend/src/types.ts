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
export type WordEntry = {
  id: number
  word_set_id?: number
  spelling: string
  phonetic: string
  meaning_zh: string
  technical_meaning_zh: string
  active?: boolean
  enrichment_status?: 'pending' | 'processing' | 'ready' | 'failed'
  enrichment_attempts?: number
  enrichment_error?: string
}
export type WordSetSummary = {
  id: number
  title: string
  description: string
  sort_order?: number
  active?: boolean
  word_count: number
  attempts?: number
  best_cpm?: number | null
  best_accuracy?: number | null
  status_counts?: Record<string, number>
  words?: WordEntry[]
}
export type WordSetDetail = { id: number; title: string; description: string; words: WordEntry[] }
export type LlmStatus = { configured: boolean; base_url: string; model: string }
export type Report = {
  attempt_count: number
  practice_minutes: number
  average_cpm: number
  accuracy: number
  weak_keys: { char: string; count: number }[]
  attempts: { id: number; child_id: number; lesson_id: number | null; word_set_id?: number | null; word_id?: number | null; mode?: 'course' | 'word'; cpm: number; accuracy: number; errors: number; duration_ms: number; created_at: string }[]
}

export type ExerciseQuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'programming'
export type QuestionOption = { id?: number; label: string; content_markdown: string; correct?: boolean; sort_order: number }
export type ProgrammingCase = { id?: number; input_data: string; expected_output: string; is_sample: boolean; weight: number; confirmed?: boolean; note?: string }
export type ProgrammingSpec = {
  input_markdown: string
  output_markdown: string
  constraints_markdown: string
  starter_code: string
  reference_solution?: string
  time_limit_ms: number
  memory_limit_mb: number
  cases: ProgrammingCase[]
}
export type ExerciseQuestion = {
  id: number
  question_set_id?: number
  question_set_title?: string
  type: ExerciseQuestionType
  stem_markdown: string
  explanation_markdown?: string
  points: number
  sort_order: number
  reviewed?: boolean
  correct_bool?: boolean | null
  source_page?: number | null
  source_asset_id?: number | null
  show_source_crop?: boolean
  options: QuestionOption[]
  programming?: ProgrammingSpec | null
}
export type QuestionSetSummary = {
  id: number
  title: string
  description: string
  status: 'draft' | 'published' | 'archived'
  sort_order?: number
  question_count: number
  counts: Record<ExerciseQuestionType, number>
  total_points: number
  best_score?: number | null
  best_max_score?: number | null
  attempts?: number
  source_pdf_asset_id?: number | null
  questions?: ExerciseQuestion[]
}
export type ExerciseSessionItem = {
  id: number
  sort_order: number
  points: number
  question: ExerciseQuestion
  answer: {
    selected_option_ids: number[]
    bool_answer: boolean | null
    code: string
    status: string
    awarded_points?: number
    details?: { correct?: boolean; passed?: number; total?: number; cases?: { id?: number; status: string; duration_ms?: number; weight?: number }[] }
  }
}
export type ExerciseSession = {
  id: number
  title: string
  mode: 'set' | 'random' | 'wrong'
  status: 'in_progress' | 'judging' | 'completed'
  score: number | null
  max_score: number
  items: ExerciseSessionItem[]
}

