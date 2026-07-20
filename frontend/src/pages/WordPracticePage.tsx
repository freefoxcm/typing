import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import { PracticeRunner } from '../components/PracticeRunner'
import type { WordSetDetail } from '../types'

export function WordPracticePage() {
  const { wordSetId } = useParams()
  const [wordSet, setWordSet] = useState<WordSetDetail | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => { api<WordSetDetail>(`/api/library/word-sets/${wordSetId}`).then(setWordSet).catch((error) => setMessage(error.message)) }, [wordSetId])
  if (!wordSet) return <div className="page"><p className={message ? 'notice error' : 'notice'}>{message || '正在准备单词练习…'}</p></div>
  return <PracticeRunner
    contextLabel="单词练习"
    title={wordSet.title}
    backLabel="返回单词集"
    items={wordSet.words.map((word) => ({ ...word, content: word.spelling }))}
    savePath="/api/practice/word-attempts"
    saveIdKey="word_id"
    renderInfo={(word) => <aside className="word-info-card" aria-label="单词释义">
      <p className="eyebrow">美式音标</p><strong className="word-phonetic">{word.phonetic}</strong>
      <section><span>常用释义</span><p>{word.meaning_zh}</p></section>
      {word.technical_meaning_zh && <section className="technical-meaning"><span>计算机领域</span><p>{word.technical_meaning_zh}</p></section>}
    </aside>}
  />
}
