import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowRight, BookCheck, BookOpen, ChevronDown, Gauge, Keyboard, Languages, Sparkles, Target } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { Course, ExerciseSessionSummary, Me, QuestionSetSummary, WordSetSummary } from '../types'
import { ExerciseHomeSection } from './ExerciseHomeSection'

type PracticeArea = 'words' | 'typing' | 'exercises'

const practiceAreaMeta = {
  words: { label: '单词练习', Icon: Languages },
  typing: { label: '打字练习', Icon: Keyboard },
  exercises: { label: '习题练习', Icon: BookCheck },
} satisfies Record<PracticeArea, { label: string; Icon: typeof Languages }>

export function ChildHomePage({ me }: { me: Me }) {
  const [courses, setCourses] = useState<Course[]>([])
  const [wordSets, setWordSets] = useState<WordSetSummary[]>([])
  const [questionSets, setQuestionSets] = useState<QuestionSetSummary[]>([])
  const [activeExerciseSessions, setActiveExerciseSessions] = useState<ExerciseSessionSummary[]>([])
  const [expandedCourses, setExpandedCourses] = useState<Set<number>>(() => new Set())
  const [activeArea, setActiveArea] = useState<PracticeArea | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    Promise.all([
      api<Course[]>('/api/library/courses'),
      api<WordSetSummary[]>('/api/library/word-sets'),
      api<QuestionSetSummary[]>('/api/exercises/question-sets'),
      api<ExerciseSessionSummary[]>('/api/exercises/active-sessions'),
    ])
      .then(([courseItems, wordSetItems, questionSetItems, sessionItems]) => {
        setCourses(courseItems)
        setWordSets(wordSetItems)
        setQuestionSets(questionSetItems.filter((item) => item.status === 'published'))
        setActiveExerciseSessions(sessionItems)
      })
      .catch((e) => setError(e.message))
  }, [])
  const toggleCourse = (courseId: number) => setExpandedCourses((current) => {
    const next = new Set(current)
    if (next.has(courseId)) next.delete(courseId); else next.add(courseId)
    return next
  })
  const attempts = courses.flatMap((c) => c.lessons).reduce((sum, lesson) => sum + (lesson.attempts ?? 0), 0) + wordSets.reduce((sum, item) => sum + (item.attempts ?? 0), 0) + questionSets.reduce((sum, item) => sum + (item.attempts ?? 0), 0)
  const best = Math.max(0, ...courses.flatMap((c) => c.lessons).map((lesson) => lesson.best_cpm ?? 0), ...wordSets.map((item) => item.best_cpm ?? 0))
  const availableAreas: PracticeArea[] = [
    ...(wordSets.length > 0 ? ['words' as const] : []),
    ...(courses.length > 0 ? ['typing' as const] : []),
    ...(questionSets.length > 0 || activeExerciseSessions.length > 0 ? ['exercises' as const] : []),
  ]
  const selectedArea = activeArea && availableAreas.includes(activeArea) ? activeArea : (availableAreas[0] ?? null)
  const selectAdjacentArea = (event: ReactKeyboardEvent<HTMLButtonElement>, area: PracticeArea) => {
    const currentIndex = availableAreas.indexOf(area)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % availableAreas.length
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + availableAreas.length) % availableAreas.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = availableAreas.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextArea = availableAreas[nextIndex]
    setActiveArea(nextArea)
    document.getElementById(`practice-tab-${nextArea}`)?.focus()
  }
  return (
    <div className="page child-home">
      <section className="welcome-panel">
        <div><p className="eyebrow">欢迎回来，{me.name}</p><h1>今天想练哪一课？</h1><p>先求准确，再慢慢加速。每一次正确敲击都在让肌肉记住键位。</p></div>
        <Sparkles className="welcome-icon" />
      </section>
      <section className="quick-stats">
        <div><Target /><span><strong>{attempts}</strong>已完成练习</span></div>
        <div><Gauge /><span><strong>{best}</strong>最快字符/分钟</span></div>
        <div><BookOpen /><span><strong>{courses.length + wordSets.length + questionSets.length}</strong>可选练习</span></div>
      </section>
      {error && <p className="notice error">{error}</p>}
      {courses.length === 0 && wordSets.length === 0 && questionSets.length === 0 && activeExerciseSessions.length === 0 && !error && <div className="empty-state"><BookOpen /><h2>还没有可练习的内容</h2><p>请管理员进入后台添加课程、单词集或习题题套。</p></div>}
      {availableAreas.length > 0 && <section className="practice-hub" aria-label="练习模式">
        <div className="practice-tabs" role="tablist" aria-label="选择练习模式">
          {availableAreas.map((area) => {
            const { label, Icon } = practiceAreaMeta[area]
            const selected = selectedArea === area
            return <button type="button" className={`practice-tab practice-tab-${area}`} role="tab" id={`practice-tab-${area}`} aria-controls={`practice-panel-${area}`} aria-selected={selected} tabIndex={selected ? 0 : -1} key={area} onClick={() => setActiveArea(area)} onKeyDown={(event) => selectAdjacentArea(event, area)}><Icon />{label}</button>
          })}
        </div>
      {wordSets.length > 0 && <section className="practice-panel practice-theme-words word-set-section" role="tabpanel" id="practice-panel-words" aria-labelledby="practice-tab-words" hidden={selectedArea !== 'words'}>
        <header className="section-title practice-section-title"><div className="practice-title-copy"><span className="practice-title-icon" aria-hidden="true"><Languages /></span><div><p className="eyebrow">单词练习</p><h2>边输入，边记住单词</h2><p>看音标和释义，准确地敲出每个词。</p></div></div></header>
        <div className="word-set-grid">{wordSets.map((item) => <Link className="word-set-card" to={`/word-practice/${item.id}`} key={item.id}>
          <Languages /><div className="grow"><h3>{item.title}</h3><p>{item.description || `${item.word_count} 个可练单词`}</p><span>{item.word_count} 词 · {item.attempts ? `已练 ${item.attempts} 次` : '尚未练习'}{item.best_cpm ? ` · 最佳 ${item.best_cpm} CPM` : ''}</span></div><ArrowRight />
        </Link>)}</div>
      </section>}
      {courses.length > 0 && <section className="practice-panel practice-theme-typing typing-course-section" role="tabpanel" id="practice-panel-typing" aria-labelledby="practice-tab-typing" hidden={selectedArea !== 'typing'}>
        <header className="section-title practice-section-title"><div className="practice-title-copy"><span className="practice-title-icon" aria-hidden="true"><Keyboard /></span><div><p className="eyebrow">打字练习</p><h2>循序渐进，练出速度</h2><p>从字母、符号到代码，准确地完成每一课。</p></div></div></header>
        <div className="course-list">
        {courses.map((course, courseIndex) => {
          const courseExpanded = expandedCourses.has(course.id)
          const lessonsId = `student-course-${course.id}-lessons`
          return (
          <section className={`course-card${courseExpanded ? ' expanded' : ' collapsed'}`} key={course.id}>
            <button type="button" className="course-heading" aria-expanded={courseExpanded} aria-controls={lessonsId} aria-label={`${courseExpanded ? '收起' : '展开'}课程 ${course.title}`} onClick={() => toggleCourse(course.id)}><span className={`course-number color-${courseIndex % 4}`}>{String(courseIndex + 1).padStart(2, '0')}</span><div className="grow"><h2>{course.title}</h2><p>{course.description}</p></div><ChevronDown className="disclosure-chevron" /></button>
            {courseExpanded && <div className="lesson-grid" id={lessonsId}>
              {course.lessons.map((lesson) => (
                <Link className="lesson-card" to={`/practice/${lesson.id}`} key={lesson.id}>
                  <div><h3>{lesson.title}</h3><p>{lesson.description || `${lesson.prompt_count} 条练习`}</p></div>
                  <div className="lesson-meta"><span>{lesson.attempts ? `练习 ${lesson.attempts} 次` : '尚未练习'}</span>{lesson.best_cpm ? <span>最佳 {lesson.best_cpm} CPM</span> : null}<ArrowRight /></div>
                </Link>
              ))}
            </div>}
          </section>
          )
        })}
        </div>
      </section>}
      {(questionSets.length > 0 || activeExerciseSessions.length > 0) && <section className="practice-panel practice-theme-exercises" role="tabpanel" id="practice-panel-exercises" aria-labelledby="practice-tab-exercises" hidden={selectedArea !== 'exercises'}><ExerciseHomeSection sets={questionSets} activeSessions={activeExerciseSessions} onActiveSessionsChange={setActiveExerciseSessions} /></section>}
      </section>}
    </div>
  )
}

