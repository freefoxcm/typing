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
  best_cpm_version?: number | null
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
export type AttemptResult = { id: number; cpm: number | null; accuracy: number; errors: number; duration_ms: number; speed_char_count: number; metric_version: number }
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
  best_cpm_version?: number | null
  best_accuracy?: number | null
  status_counts?: Record<string, number>
  words?: WordEntry[]
}
export type WordSetDetail = { id: number; title: string; description: string; words: WordEntry[] }
export type LlmStatus = { configured: boolean; base_url: string; model: string; reasoning_effort?: string | null }
export type Report = {
  attempt_count: number
  practice_minutes: number
  average_cpm: number | null
  cpm_metric_version: number | null
  cpm_attempt_count: number
  accuracy: number
  weak_keys: { char: string; count: number }[]
  attempts: { id: number; child_id: number; lesson_id: number | null; word_set_id?: number | null; word_id?: number | null; mode?: 'course' | 'word'; cpm: number | null; accuracy: number; errors: number; duration_ms: number; speed_char_count: number; metric_version: number; created_at: string }[]
}

export type ReportOverviewRow = {
  child_id: number
  child_name: string
  active: boolean
  course_attempt_count: number
  word_attempt_count: number
  practice_minutes: number
  average_cpm: number | null
  cpm_metric_version: number | null
  cpm_attempt_count: number
  accuracy: number
  exercise_total: number
  exercise_completed: number
  exercise_completion_rate: number
  exercise_average_percent: number
  unresolved_wrong_count: number
}
export type ReportOverview = { days: number; students: ReportOverviewRow[] }
export type ExerciseAdminReport = {
  session_count: number
  total_session_count: number
  status_counts: Record<'in_progress' | 'judging' | 'completed' | 'abandoned', number>
  completion_rate: number
  average_percent: number
  unresolved_wrong_count: number
  recent: { id: number; child_id: number; mode: string; status: string; title: string; score: number; max_score: number; created_at: string; completed_at: string | null }[]
}

export type LearningAnalysisTrend = {
  current: number
  previous: number | null
  delta: number | null
  unit: 'percentage_point' | 'count'
}
export type LearningAnalysisStudent = { child_id: number; child_name: string; count: number; last_at: string }
export type LearningAnalysisIssue = {
  affected_student_count: number
  small_sample: boolean
  students: LearningAnalysisStudent[]
  trend: LearningAnalysisTrend
  recommendation: string
}
export type LearningAnalysisTypingIssue = LearningAnalysisIssue & {
  expected_char: string
  actual_char?: string
  error_count: number
  error_share: number
  sample_size: number
}
export type LearningAnalysisWordIssue = LearningAnalysisIssue & {
  word_key: string
  word_id: number | null
  word: string
  word_set_id: number | null
  word_set_title: string
  attempt_count: number
  wrong_attempt_count: number
  wrong_rate: number
  average_accuracy: number
  error_count: number
  top_confusions: { expected_char: string; actual_char: string; count: number }[]
}
export type LearningAnalysisQuestionIssue = LearningAnalysisIssue & {
  question_key: string
  question_id: number | null
  question_set_title: string
  question_type: string
  stem_markdown: string
  correct_answer: string
  attempt_count: number
  wrong_count: number
  wrong_rate: number
  current_unmastered_count: number
  common_wrong_answers: { label: string; count: number }[]
}
export type LearningAnalysisProgrammingFailure = LearningAnalysisIssue & {
  status: string
  attempt_count: number
  question_count: number
}
export type LearningAnalysis = {
  period: { days: number; current_start: string; current_end: string; previous_start: string; previous_end: string }
  summary: {
    participating_students: number
    typing_attempts: number
    word_attempts: number
    practice_attempts: number
    practice_minutes: number
    overall_accuracy: number
    completed_exercise_sessions: number
    exercise_question_attempts: number
    exercise_wrong_rate: number
  }
  insights: { category: 'typing' | 'word' | 'exercise'; title: string; description: string; recommendation: string }[]
  typing: { weak_keys: LearningAnalysisTypingIssue[]; confusion_pairs: LearningAnalysisTypingIssue[] }
  words: { difficult_words: LearningAnalysisWordIssue[] }
  exercises: {
    difficult_questions: LearningAnalysisQuestionIssue[]
    persistent_questions: LearningAnalysisQuestionIssue[]
    programming_failures: LearningAnalysisProgrammingFailure[]
  }
}

export type ExerciseQuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'fill_blank' | 'programming'
export type QuestionOption = { id?: number; label: string; content_markdown: string; correct?: boolean; sort_order: number }
export type QuestionBlank = { id?: number; position: number; accepted_answers?: string[] }
export type ProgrammingCase = { id?: number; input_data: string; expected_output: string; is_sample: boolean; weight: number; confirmed?: boolean; note?: string; explanation_markdown?: string }
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
  source_end_page?: number | null
  source_section?: string
  source_number?: string
  recognition_confidence?: number | null
  recognition_warnings?: string[]
  source_asset_id?: number | null
  stem_image_asset_id?: number | null
  show_source_crop?: boolean
  options: QuestionOption[]
  blanks?: QuestionBlank[]
  programming?: ProgrammingSpec | null
}
export type QuestionSetSummary = {
  id: number
  title: string
  description: string
  status: 'draft' | 'published' | 'archived'
  sort_order?: number
  question_count: number
  counts: Partial<Record<ExerciseQuestionType, number>>
  total_points: number
  best_score?: number | null
  best_max_score?: number | null
  attempts?: number
  source_pdf_asset_id?: number | null
  questions?: ExerciseQuestion[]
}

export type QuestionBundleAction = 'create' | 'skip' | 'copy' | 'overwrite'
export type QuestionBundlePreviewSet = {
  migration_key: string
  title: string
  source_status: string
  fingerprint: string
  question_count: number
  counts: Record<ExerciseQuestionType, number>
  asset_count: number
  programming_case_count: number
  has_source_pdf: boolean
  conflict: 'none' | 'same_origin_unchanged' | 'same_origin_changed'
  default_action: QuestionBundleAction
  allowed_actions: QuestionBundleAction[]
  target?: { id: number; title: string; status: string; fingerprint: string } | null
  warnings: string[]
}
export type QuestionBundlePreview = {
  valid: boolean
  version?: number
  bundle_id?: string
  question_set_count?: number
  question_count?: number
  asset_count?: number
  question_sets: QuestionBundlePreviewSet[]
  errors: string[]
}
export type QuestionBundleImportResult = {
  ok: boolean
  created: { id: number; title: string }[]
  copied: { id: number; title: string }[]
  overwritten: { id: number; title: string }[]
  skipped: { migration_key: string; title: string }[]
}
export type ExerciseSessionItem = {
  id: number
  sort_order: number
  points: number
  question: ExerciseQuestion
  answer: {
    selected_option_ids: number[]
    bool_answer: boolean | null
    blank_answers?: string[]
    code: string
    status: string
    awarded_points?: number
    details?: {
      correct?: boolean
      blank_correct?: boolean[]
      passed?: number
      total?: number
      cases?: { id?: number; status: string; duration_ms?: number; weight?: number; stdout?: string; stderr?: string }[]
    }
  }
}
export type ExerciseSession = {
  id: number
  title: string
  mode: 'set' | 'random' | 'wrong'
  status: ExerciseSessionStatus
  score: number | null
  max_score: number
  current_item_sort_order?: number | null
  created_at?: string
  submitted_at?: string | null
  completed_at?: string | null
  items: ExerciseSessionItem[]
}

export type ExerciseSessionStatus = 'in_progress' | 'judging' | 'completed' | 'abandoned'

export type ExerciseSessionSummary = {
  id: number
  title: string
  mode: ExerciseSession['mode']
  status: 'in_progress' | 'judging'
  answered_count: number
  total_count: number
  created_at: string
  last_activity_at: string
}

