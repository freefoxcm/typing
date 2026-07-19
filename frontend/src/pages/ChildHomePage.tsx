import { useEffect, useState } from 'react'
import { ArrowRight, BookOpen, Gauge, Sparkles, Target } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { Course, Me } from '../types'

export function ChildHomePage({ me }: { me: Me }) {
  const [courses, setCourses] = useState<Course[]>([])
  const [error, setError] = useState('')
  useEffect(() => { api<Course[]>('/api/library/courses').then(setCourses).catch((e) => setError(e.message)) }, [])
  const attempts = courses.flatMap((c) => c.lessons).reduce((sum, lesson) => sum + (lesson.attempts ?? 0), 0)
  const best = Math.max(0, ...courses.flatMap((c) => c.lessons).map((lesson) => lesson.best_cpm ?? 0))
  return (
    <div className="page child-home">
      <section className="welcome-panel">
        <div><p className="eyebrow">欢迎回来，{me.name}</p><h1>今天想练哪一课？</h1><p>先求准确，再慢慢加速。每一次正确敲击都在让肌肉记住键位。</p></div>
        <Sparkles className="welcome-icon" />
      </section>
      <section className="quick-stats">
        <div><Target /><span><strong>{attempts}</strong>已完成练习</span></div>
        <div><Gauge /><span><strong>{best}</strong>最快字符/分钟</span></div>
        <div><BookOpen /><span><strong>{courses.length}</strong>可选课程</span></div>
      </section>
      {error && <p className="notice error">{error}</p>}
      {courses.length === 0 && !error && <div className="empty-state"><BookOpen /><h2>还没有可练习的课程</h2><p>请管理员进入后台添加或导入词库。</p></div>}
      <div className="course-list">
        {courses.map((course, courseIndex) => (
          <section className="course-card" key={course.id}>
            <div className="course-heading"><span className={`course-number color-${courseIndex % 4}`}>{String(courseIndex + 1).padStart(2, '0')}</span><div><h2>{course.title}</h2><p>{course.description}</p></div></div>
            <div className="lesson-grid">
              {course.lessons.map((lesson) => (
                <Link className="lesson-card" to={`/practice/${lesson.id}`} key={lesson.id}>
                  <div><h3>{lesson.title}</h3><p>{lesson.description || `${lesson.prompt_count} 条练习`}</p></div>
                  <div className="lesson-meta"><span>{lesson.attempts ? `练习 ${lesson.attempts} 次` : '尚未练习'}</span>{lesson.best_cpm ? <span>最佳 {lesson.best_cpm} CPM</span> : null}<ArrowRight /></div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

