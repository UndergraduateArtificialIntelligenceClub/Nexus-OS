import { ArticleReader, EmptyState } from '@/ui'
import type { AppProps } from '@/apps/types'
import { useMedia } from '@/apps/mediaInbox'
import './reader.css'

// The reader widget: the article last sent to it through the media inbox, set
// for reading. Size and mode go to the reader as its layout key, so it keeps
// the same paragraph at the top through resize, fullscreen and the dock.

export function ReaderApp({ size, mode }: AppProps) {
  const article = useMedia('article')
  if (!article) return <EmptyState className="w-reader-empty" hint="open an article from the browser" />
  return <ArticleReader className="w-reader" title={article.title} blocks={article.blocks} evidenceRefs={article.evidenceRefs} layoutKey={`${size}:${mode}`} />
}
