import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import { PracticeRunner } from '../components/PracticeRunner'
import type { LessonDetail } from '../types'

export function PracticePage() {
  const { lessonId } = useParams()
  const [lesson, setLesson] = useState<LessonDetail | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    api<LessonDetail>(`/api/library/lessons/${lessonId}`).then(setLesson).catch((error) => setMessage(error.message))
  }, [lessonId])

  if (!lesson) return <div className="page"><p className={message ? 'notice error' : 'notice'}>{message || '正在准备练习…'}</p></div>
  return <PracticeRunner
    contextLabel={lesson.course.title}
    title={lesson.title}
    backLabel="返回课程"
    items={lesson.prompts.map((prompt) => ({ id: prompt.id, content: prompt.content }))}
    savePath="/api/practice/attempts"
    saveIdKey="prompt_id"
  />
}
