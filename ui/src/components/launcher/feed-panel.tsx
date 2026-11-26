import { useCallback, useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import {
  ArrowLeft,
  ExternalLink,
  Gamepad2,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCw,
  Repeat2,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  FEED_WIDTH,
  invoke,
  LINKS,
  openUrl,
  shortTime,
  type FeedMe,
  type FeedPage,
  type FeedPost,
  type FeedTab,
  type FeedThread,
  type Info,
} from "@/lib/api"
import { cn } from "@/lib/utils"

const TABS: { id: FeedTab; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "following", label: "Подписки" },
  { id: "news", label: "Новости" },
]

const POST_MAX = 500

// Лента сайта в колонке справа: вкладки, посты, лайки, ответы и свой пост.
// Входит сама аккаунтом Minecraft лаунчера (без Discord), если он есть.
export function FeedPanel({ info, onClose }: { info: Info | null; onClose: () => void }) {
  const reduced = useReducedMotion()
  const [tab, setTab] = useState<FeedTab>("all")
  const [posts, setPosts] = useState<FeedPost[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [me, setMe] = useState<FeedMe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [authing, setAuthing] = useState(false)
  const account = info?.account?.name ?? null
  const scroller = useRef<HTMLDivElement>(null)

  // Вход: если для этого аккаунта ещё нет сессии ленты, проверяем лицензию через Mojang.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    setReady(false)
    ;(async () => {
      if (account) {
        const session = await invoke<string | null>("feed_session").catch(() => null)
        if (session !== account) {
          setAuthing(true)
          await invoke<FeedMe>("feed_login")
            .then((m) => alive && setMe(m))
            .catch((e) => alive && setError(`Не получилось войти в ленту: ${e}`))
          if (alive) setAuthing(false)
        }
      }
      if (alive) setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [account])

  const load = useCallback(
    async (more: boolean) => {
      setLoading(true)
      try {
        const page = await invoke<FeedPage>("feed_timeline", {
          tab,
          before: more ? next : null,
        })
        setPosts((p) => (more && p ? [...p, ...page.posts] : page.posts))
        setNext(page.next)
        setMe(page.me)
        setError(null)
      } catch (e) {
        setError(String(e))
        setPosts((p) => p ?? [])
      } finally {
        setLoading(false)
      }
    },
    [tab, next]
  )

  useEffect(() => {
    if (!ready) return
    setPosts(null)
    setNext(null)
    scroller.current?.scrollTo({ top: 0 })
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ready])

  // Подгрузка следующей страницы у нижнего края.
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !next) return
    const io = new IntersectionObserver(
      (e) => e[0].isIntersecting && !loading && load(true),
      { root: scroller.current, rootMargin: "300px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [next, loading, load])

  const patch = (id: number, f: (p: FeedPost) => FeedPost) =>
    setPosts((ps) => ps?.map((p) => (p.id === id ? f(p) : p)) ?? ps)

  return (
    <motion.aside
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25 }}
      style={{ width: FEED_WIDTH }}
      className="relative z-10 flex h-full shrink-0 flex-col border-l bg-background"
    >
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        {open ? (
          <Button variant="ghost" size="icon-sm" aria-label="Назад" onClick={() => setOpen(null)}>
            <ArrowLeft />
          </Button>
        ) : null}
        <span className="text-sm font-semibold tracking-tight">{open ? "Пост" : "Лента"}</span>
        <span className="flex-1" />
        {!open && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Обновить"
            onClick={() => load(false)}
            disabled={loading}
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Открыть на сайте"
          onClick={() => openUrl(open ? `${LINKS.site}/p/${open}` : `${LINKS.site}/feed`)}
        >
          <ExternalLink />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Закрыть ленту" onClick={onClose}>
          <X />
        </Button>
      </header>

      {open ? (
        <ThreadView code={open} me={me} onOpen={setOpen} />
      ) : (
        <>
          <nav className="flex shrink-0 border-b">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative flex-1 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
                  tab === t.id && "font-medium text-foreground"
                )}
              >
                {t.label}
                {tab === t.id && (
                  <span className="absolute inset-x-1/4 bottom-0 h-0.5 rounded-full bg-foreground" />
                )}
              </button>
            ))}
          </nav>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <Status me={me} account={account} authing={authing} />
            {me?.linked && tab !== "news" && (
              <Composer
                me={me}
                placeholder="Что нового?"
                onPosted={() => load(false)}
              />
            )}
            {error && <p className="border-b px-4 py-3 text-sm text-destructive">{error}</p>}
            {posts === null ? (
              <Spinner />
            ) : posts.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {tab === "following"
                  ? me?.linked
                    ? "Подпишись на игроков на сайте, и их посты появятся здесь."
                    : "Подписки видны после входа."
                  : "Пока пусто."}
              </p>
            ) : (
              posts.map((p) => (
                <PostCard
                  key={`${p.id}-${p.repostedBy?.discordId ?? ""}`}
                  post={p}
                  me={me}
                  onOpen={setOpen}
                  onChange={(f) => patch(p.id, f)}
                />
              ))
            )}
            <div ref={sentinel} />
            {posts && next && loading && <Spinner />}
          </div>
        </>
      )}
    </motion.aside>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-6 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  )
}

/** Кто вошёл, или почему писать нельзя. */
function Status({ me, account, authing }: { me: FeedMe | null; account: string | null; authing: boolean }) {
  if (authing)
    return (
      <p className="flex items-center gap-2 border-b px-4 py-2.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Входим в ленту как {account}…
      </p>
    )
  if (!account)
    return (
      <p className="border-b px-4 py-2.5 text-xs text-muted-foreground">
        Войдите через Microsoft, чтобы ставить лайки и писать в ленту.
      </p>
    )
  if (me && !me.linked)
    return (
      <div className="border-b px-4 py-2.5 text-xs text-muted-foreground">
        Ник {me.name} не привязан к аккаунту на сайте, поэтому лента только для чтения.{" "}
        <button
          type="button"
          className="text-sky-400 hover:underline"
          onClick={() => openUrl(`${LINKS.site}/account`)}
        >
          Привязать ник
        </button>
      </div>
    )
  return null
}

function Avatar({ src, size = 40 }: { src: string | null; size?: number }) {
  return (
    <img
      src={src ?? "/logo.png"}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className="shrink-0 rounded-lg bg-muted [image-rendering:pixelated]"
      style={{ width: size, height: size }}
      onError={(e) => (e.currentTarget.src = "/logo.png")}
    />
  )
}

function Nick({ post }: { post: FeedPost }) {
  return (
    <span
      className="truncate font-semibold text-foreground"
      style={post.author.nitroColor ? { color: post.author.nitroColor } : undefined}
    >
      {post.author.nickname}
    </span>
  )
}

function PostCard({
  post,
  me,
  onOpen,
  onChange,
  big,
  threadLine,
}: {
  post: FeedPost
  me: FeedMe | null
  onOpen: (code: string) => void
  onChange: (f: (p: FeedPost) => FeedPost) => void
  big?: boolean
  threadLine?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const like = async () => {
    if (!me?.linked) {
      setErr(me ? "Сначала привяжи ник на сайте." : "Войдите через Microsoft.")
      return
    }
    if (busy) return
    const on = !post.liked
    setBusy(true)
    onChange((p) => ({ ...p, liked: on, likes: p.likes + (on ? 1 : -1) }))
    try {
      const r = await invoke<{ error?: string }>("feed_like", { id: post.id, on })
      if (r.error) throw r.error
    } catch (e) {
      onChange((p) => ({ ...p, liked: !on, likes: p.likes + (on ? -1 : 1) }))
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      onClick={big ? undefined : () => onOpen(post.code)}
      className={cn(
        "relative flex gap-3 px-4 py-3",
        !big && "cursor-pointer transition-colors hover:bg-muted/30",
        !threadLine && "border-b",
        post.status !== "visible" && "bg-amber-500/5"
      )}
    >
      {threadLine && (
        <span aria-hidden className="absolute top-14 bottom-0 left-[35px] w-0.5 bg-border" />
      )}
      <Avatar src={post.author.avatar} />
      <div className="min-w-0 flex-1">
        {post.repostedBy && (
          <p className="mb-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Repeat2 className="size-3" /> {post.repostedBy.nickname} переслал(а)
          </p>
        )}
        <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <Nick post={post} />
          {post.source === "game" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-dashed px-1.5 text-[11px]">
              <Gamepad2 className="size-3" /> из игры
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs" title={new Date(post.createdAt).toLocaleString("ru-RU")}>
            {shortTime(post.createdAt)}
          </span>
        </div>
        {post.replyTo && (
          <p className="text-xs text-muted-foreground">
            в ответ <span className="text-sky-400">@{post.replyTo.nickname}</span>
          </p>
        )}
        {post.status !== "visible" && post.hiddenReason && (
          <p className="mt-1 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
            На проверке: {post.hiddenReason}
          </p>
        )}
        {post.body && (
          <div className={cn("mt-0.5 break-words whitespace-pre-wrap", big ? "text-base" : "text-sm")}>
            {post.body}
          </div>
        )}
        {post.news && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              openUrl(`${LINKS.site}/news/${post.news!.slug}`)
            }}
            className="mt-2 flex w-full overflow-hidden rounded-xl border text-left transition hover:bg-muted/50"
          >
            {post.news.cover && <img src={post.news.cover} alt="" className="w-24 shrink-0 object-cover" />}
            <span className="flex min-w-0 flex-col gap-0.5 p-2.5 text-sm">
              <span className="font-medium">{post.news.title}</span>
              <span className="text-xs text-muted-foreground">Читать статью</span>
            </span>
          </button>
        )}
        <Media post={post} />
        {post.quote && (
          <div
            onClick={(e) => {
              e.stopPropagation()
              onOpen(post.quote!.code)
            }}
            className="mt-2 rounded-xl border p-2.5 transition hover:bg-muted/50"
          >
            <span className="flex items-center gap-2 text-sm">
              <Avatar src={post.quote.author.avatar} size={18} />
              <Nick post={post.quote} />
              <span className="text-xs text-muted-foreground">· {shortTime(post.quote.createdAt)}</span>
            </span>
            {post.quote.body && (
              <span className="mt-1 line-clamp-4 block text-sm whitespace-pre-wrap">{post.quote.body}</span>
            )}
          </div>
        )}
        {post.status === "visible" && (
          <div className="-ml-2 mt-1 flex items-center gap-1 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
            <Action
              label="Нравится"
              onClick={like}
              className={cn("hover:bg-rose-500/10 hover:text-rose-400", post.liked && "text-rose-400")}
            >
              <Heart className={cn("size-4", post.liked && "fill-current")} /> {post.likes || ""}
            </Action>
            <Action label="Пересылки">
              <Repeat2 className="size-4" /> {post.reposts || ""}
            </Action>
            <Action label="Ответить" onClick={() => onOpen(post.code)}>
              <MessageCircle className="size-4" /> {post.replies || ""}
            </Action>
          </div>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    </article>
  )
}

function Action({
  label,
  onClick,
  className,
  children,
}: {
  label: string
  onClick?: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "inline-flex h-8 min-w-12 items-center gap-1.5 rounded-full px-2 text-xs tabular-nums transition enabled:hover:bg-sky-500/10 enabled:hover:text-sky-400",
        className
      )}
    >
      {children}
    </button>
  )
}

function Media({ post }: { post: FeedPost }) {
  const media = post.media
  if (media.length === 0) return null
  if (media[0].kind === "video")
    return (
      <video
        src={media[0].url}
        controls
        preload="metadata"
        onClick={(e) => e.stopPropagation()}
        className="mt-2 max-h-80 w-full rounded-xl border bg-black"
      />
    )
  const one = media.length === 1
  return (
    <div className={cn("mt-2 grid gap-1 overflow-hidden rounded-xl border", !one && "grid-cols-2")}>
      {media.map((m, i) => (
        <button
          key={m.url}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            openUrl(m.url)
          }}
          className={cn("relative block bg-muted", media.length === 3 && i === 0 && "row-span-2")}
        >
          <img
            src={m.url}
            alt={m.alt ?? ""}
            loading="lazy"
            className={cn("w-full object-cover", one ? "max-h-80" : "h-full max-h-40")}
          />
        </button>
      ))}
    </div>
  )
}

function Composer({
  me,
  placeholder,
  replyTo,
  onPosted,
}: {
  me: FeedMe
  placeholder: string
  replyTo?: number
  onPosted: () => void
}) {
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ error?: boolean; text: string } | null>(null)
  const left = POST_MAX - body.length

  const submit = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    setNote(null)
    try {
      const r = await invoke<{ error?: string; pending?: boolean }>("feed_post", {
        body,
        replyTo: replyTo ?? null,
      })
      if (r.error) setNote({ error: true, text: r.error })
      else {
        setBody("")
        if (r.pending) setNote({ text: "Пост ушёл на проверку модератору." })
        onPosted()
      }
    } catch (e) {
      setNote({ error: true, text: String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-3 border-b px-4 py-3">
      <Avatar src={me.avatar} />
      <div className="min-w-0 flex-1">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit()
          }}
          rows={body ? 3 : 1}
          maxLength={2000}
          placeholder={placeholder}
          className="w-full resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        {note && (
          <p className={cn("text-xs", note.error ? "text-destructive" : "text-muted-foreground")}>{note.text}</p>
        )}
        <div className="mt-1 flex items-center justify-end gap-3">
          {body.length > 0 && (
            <span className={cn("text-xs tabular-nums text-muted-foreground", left < 0 && "text-destructive")}>
              {left}
            </span>
          )}
          <Button size="sm" onClick={submit} disabled={!body.trim() || busy}>
            {busy && <Loader2 className="animate-spin" />}
            {replyTo ? "Ответить" : "Опубликовать"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ThreadView({ code, me, onOpen }: { code: string; me: FeedMe | null; onOpen: (c: string) => void }) {
  const [thread, setThread] = useState<FeedThread | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    invoke<FeedThread>("feed_thread", { code })
      .then((t) => {
        setThread(t)
        setError(null)
      })
      .catch((e) => setError(String(e)))
  }, [code])

  useEffect(() => {
    setThread(null)
    load()
  }, [load])

  const patch = (id: number, f: (p: FeedPost) => FeedPost) =>
    setThread((t) =>
      t && {
        ...t,
        post: t.post.id === id ? f(t.post) : t.post,
        ancestors: t.ancestors.map((p) => (p.id === id ? f(p) : p)),
        replies: t.replies.map((p) => (p.id === id ? f(p) : p)),
      }
    )

  if (error) return <p className="px-4 py-6 text-sm text-destructive">{error}</p>
  if (!thread) return <Spinner />
  const who = thread.me ?? me
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {thread.ancestors.map((p) => (
        <PostCard key={p.id} post={p} me={who} onOpen={onOpen} onChange={(f) => patch(p.id, f)} threadLine />
      ))}
      <PostCard post={thread.post} me={who} onOpen={onOpen} onChange={(f) => patch(thread.post.id, f)} big />
      {who?.linked && thread.post.status === "visible" && (
        <Composer me={who} placeholder={`Ответ для ${thread.post.author.nickname}`} replyTo={thread.post.id} onPosted={load} />
      )}
      {thread.replies.map((p) => (
        <PostCard key={p.id} post={p} me={who} onOpen={onOpen} onChange={(f) => patch(p.id, f)} />
      ))}
      {thread.replies.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Ответов пока нет.</p>
      )}
    </div>
  )
}
