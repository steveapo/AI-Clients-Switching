"use client"

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { Check, Copy } from "lucide-react"
import gsap from "gsap"
import { TextMorph, type TextMorphProps } from "torph/react"

import { cn } from "@/lib/utils"

const MCP_URL = "https://mcp.mode.com"

/**
 * One spring for every morph on the page. A spring rather than a fixed
 * duration: the glyphs settle on their own physics, so long and short swaps
 * both come to rest smoothly instead of racing a clock.
 */
const MORPH: Pick<TextMorphProps, "ease"> = {
  ease: { stiffness: 140, damping: 22, mass: 1.1 },
}

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * The beam's beats, in seconds. Its halo lets go first, then the plain overlay
 * crosses the grid, then the halo blooms back on the card it landed on — three
 * stages rather than one blur of movement, and slow enough to be watched. The
 * last two overlap by `overlap`, so the glow catches the overlay as it settles
 * instead of waiting out the long tail of its easing.
 */
const BEAM = {
  glowOut: 0.15,
  travel: 0.53,
  glowIn: 0.35,
  overlap: 0.13,
}


/** a highlighted run inside a snippet: command/key, flag, or plain text */
type Tone = "key" | "flag" | "punct"
type Token = { text: string; tone?: Tone }

const toneClass: Record<Tone, string> = {
  key: "text-violet-300",
  flag: "text-amber-300",
  punct: "text-zinc-500",
}

type Client = {
  id: string
  name: string
  logo: string | null
  /** a logo whose artwork wants a different box than the default */
  iconClass?: string
  /** and the same, inside the small round chip on the CTA */
  chipIconClass?: string
  /** a ready-made white mark for logos that lose their shape when flattened */
  chipLogo?: string
  /** step 02 copy, one variant per client */
  blurb: string
  /** clients without a one-click install go straight to the snippet */
  cta?: string
  snippetLabel: string
  snippet: Token[]
  copyText: string
  /** trailing note; objects render as inline code chips */
  footnote?: Array<string | { code: string }>
}

const clients: Client[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    logo: "/logos/openai.png",
    blurb: "Works in ChatGPT on any plan with connectors enabled.",
    cta: "Add to ChatGPT",
    snippetLabel: "Or add it by hand under Settings → Connectors:",
    snippet: [{ text: MCP_URL }],
    copyText: MCP_URL,
  },
  {
    id: "claude",
    name: "Claude",
    logo: "/logos/claude.png",
    blurb: "Works in Claude.ai (web, iOS, Android) and Claude Desktop.",
    snippetLabel: "Add the server from your terminal:",
    snippet: [
      { text: "claude", tone: "key" },
      { text: " mcp add " },
      { text: "--transport", tone: "flag" },
      { text: ` http mode ${MCP_URL}` },
    ],
    copyText: `claude mcp add --transport http mode ${MCP_URL}`,
    footnote: [
      "Then start Claude Code with ",
      { code: "claude" },
      " and run ",
      { code: "/mcp" },
      " to finish the browser sign-in.",
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    logo: "/logos/cursor.svg",
    chipLogo: "/logos/cursor-white.svg",
    blurb: "Works in Cursor's MCP settings, per project or globally.",
    cta: "Add to Cursor",
    snippetLabel: "Or add the server to your MCP config:",
    snippet: [
      { text: "{ ", tone: "punct" },
      { text: '"mcpServers"', tone: "key" },
      { text: ": { ", tone: "punct" },
      { text: '"mode"' },
      { text: ": { ", tone: "punct" },
      { text: '"url"', tone: "flag" },
      { text: ": " },
      { text: `"${MCP_URL}"` },
      { text: " } }", tone: "punct" },
    ],
    copyText: `{ "mcpServers": { "mode": { "url": "${MCP_URL}" } } }`,
    footnote: [
      "Cursor reads ",
      { code: ".cursor/mcp.json" },
      " in the project, or the global config in Settings.",
    ],
  },
  {
    id: "vscode",
    name: "VS Code",
    logo: "/logos/vscode.png",
    blurb: "Works in VS Code with Copilot's agent mode.",
    cta: "Add to VS Code",
    snippetLabel: "Or add the server from your terminal:",
    snippet: [
      { text: "code", tone: "key" },
      { text: " " },
      { text: "--add-mcp", tone: "flag" },
      { text: ` '{"name":"mode","type":"http","url":"${MCP_URL}"}'` },
    ],
    copyText: `code --add-mcp '{"name":"mode","type":"http","url":"${MCP_URL}"}'`,
  },
  {
    id: "other",
    name: "Other",
    logo: null,
    blurb: "Any MCP client that speaks streamable HTTP can connect.",
    snippetLabel: "Point it at the endpoint:",
    snippet: [{ text: MCP_URL }],
    copyText: MCP_URL,
  },
]

/** the clients that ship a one-click install; their marks share one slot */
const ctaClients = clients.filter((client) => client.cta && client.logo)

const DEFAULT_CLIENT = "chatgpt"

/**
 * Every client renders the same number of snippet slots, short ones padded out.
 * A slot both clients fill morphs; a slot only one of them fills morphs out of
 * — or into — nothing. Without the padding, switching mounts finished spans at
 * full opacity next to text that is still moving, which is the pop that made
 * the snippet swap feel like two states blinking.
 *
 * The padding is a zero-width space rather than an empty string on purpose: it
 * takes no room, and it gives the morph a first render to get out of the way,
 * so the first time a slot fills it animates like every time after it.
 */
const EMPTY = "\u200B"

const SNIPPET_SLOTS = Math.max(...clients.map((client) => client.snippet.length))

const snippetSlots = (snippet: Token[]): Token[] =>
  Array.from({ length: SNIPPET_SLOTS }, (_, index) => snippet[index] ?? { text: EMPTY })

/**
 * The same trick for footnotes, which alternate prose → code chip → prose, so a
 * slot's kind is its index parity. An empty chip loses its padding and its
 * background on the way out, so it collapses with the text instead of leaving a
 * stray pill behind.
 */
const FOOTNOTE_SLOTS = Math.max(
  ...clients.map((client) => client.footnote?.length ?? 0)
)

const footnoteSlots = (footnote: Client["footnote"] | null) =>
  Array.from({ length: FOOTNOTE_SLOTS }, (_, index) => {
    const part = footnote?.[index]
    if (part === undefined)
      return { text: EMPTY, code: index % 2 === 1, filled: false }
    return typeof part === "string"
      ? { text: part, code: false, filled: true }
      : { text: part.code, code: true, filled: true }
  })

/**
 * Keeps the last real value around after it goes away, so a section that is
 * closing still has something to show while it closes.
 */
function useLastPresent<T>(value: T | null | undefined) {
  const last = useRef<T | null>(value ?? null)
  if (value != null) last.current = value
  return value ?? last.current
}

export function ConnectSection() {
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_CLIENT)
  /**
   * Which card's tube is actually running. It trails `selectedId`: the card you
   * left keeps playing until the beam has crossed, and the one you picked wakes
   * as the light lands on it, so the motion is always under the light.
   */
  const [litId, setLitId] = useState<string>(DEFAULT_CLIENT)
  const [copied, setCopied] = useState(false)
  // The CSS guard in globals.css can quiet transitions and keyframes, but the
  // ambient turbulence is SMIL inside the filters — the only way to still it is
  // to take those <animate> nodes out.
  const [reducedMotion, setReducedMotion] = useState(false)

  const selected = clients.find((client) => client.id === selectedId) ?? clients[0]

  // what the collapsing sections keep showing while they close
  const ctaClient = useLastPresent(selected.cta && selected.logo ? selected : null)
  const footnote = useLastPresent(selected.footnote)
  const hasCta = Boolean(selected.cta && selected.logo)

  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLSpanElement>(null)
  const glowRef = useRef<HTMLSpanElement>(null)
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())
  const burstRefs = useRef(new Map<string, HTMLSpanElement>())
  const copyTimer = useRef<number | undefined>(undefined)
  /** the beam's own out-move-in timeline, so a fast switch can interrupt it */
  const beamRef = useRef<gsap.core.Timeline | null>(null)
  const hasPlaced = useRef(false)

  /**
   * The ripple fires on a selection and nowhere else: it snaps to full
   * displacement on the first frame — no ramp in, that is the "suddenly" — and
   * rings out through three crests along the x-axis. It runs through the wave
   * filter for as long as it plays and then hands the picture back to the
   * ambient warp underneath, which is what active and hover keep using.
   */
  const playRipple = (id: string) => {
    const burst = burstRefs.current.get(id)
    if (!burst) return

    gsap.killTweensOf(burst)

    if (prefersReducedMotion()) {
      gsap.set(burst, { clearProps: "filter,transform" })
      return
    }

    gsap
      .timeline({
        onComplete: () => gsap.set(burst, { clearProps: "filter,transform" }),
      })
      .set(burst, {
        filter: "url(#crt-wave)",
        transformOrigin: "50% 50%",
        x: -6,
        scaleX: 1.15,
        skewX: -13,
      })
      .to(burst, { x: 4.5, scaleX: 0.91, skewX: 9, duration: 0.1, ease: "sine.inOut" })
      .to(burst, { x: -4, scaleX: 1.09, skewX: -7, duration: 0.11, ease: "sine.inOut" })
      .to(burst, { x: 2.5, scaleX: 0.96, skewX: 4.5, duration: 0.11, ease: "sine.inOut" })
      .to(burst, { x: -1.5, scaleX: 1.03, skewX: -2, duration: 0.11, ease: "sine.inOut" })
      .to(burst, { x: 0, scaleX: 1, skewX: 0, duration: 0.16, ease: "power2.out" })
  }

  const select = (id: string) => {
    if (id !== selectedId) {
      // the snippet under the button is about to be a different one
      window.clearTimeout(copyTimer.current)
      setCopied(false)
      // the burst belongs to the beam's timeline on a switch (it fires as the
      // light comes back up), so it is not started here
      setSelectedId(id)
      return
    }
    // picking the card that is already picked: nothing moves, so the tube is
    // the whole answer
    playRipple(id)
  }

  // The beam moves, but never with its halo lit: the glow lets go on the card
  // you are leaving, the plain overlay crosses the grid, and the glow blooms
  // back once it has landed. Three readable stages instead of one smear — and
  // slow on purpose, this is the movement the page is meant to be watched for.
  //
  // GSAP drives it rather than CSS: an interrupted switch picks up from
  // wherever the overlay and its glow actually are, so clicking quickly
  // through the cards never restarts either from scratch.
  useLayoutEffect(() => {
    const grid = gridRef.current
    const tile = highlightRef.current
    const glow = glowRef.current
    if (!grid || !tile || !glow) return

    // offsets, not client rects: the card's own box never moves (its hover lift
    // lives on the content inside it), so offsets describe where the beam
    // belongs even while a neighbour is mid-transition.
    //
    // The beam carries no outline of its own; it sits a hair proud of the card
    // on every side instead, so it covers the card's 1px border rather than
    // leaving a dark line drawn inside the lit area. Its radius is the card's
    // plus that same hair, so the two corners stay concentric.
    const BLEED = 1
    let last = ""

    const place = (animate: boolean) => {
      const card = cardRefs.current.get(selectedId)
      if (!card) return

      const to = {
        x: card.offsetLeft - BLEED,
        y: card.offsetTop - BLEED,
        width: card.offsetWidth + BLEED * 2,
        height: card.offsetHeight + BLEED * 2,
      }
      const key = `${to.x},${to.y},${to.width},${to.height}`
      // a resize that resized nothing is not a move; without this the observer's
      // first callback lands on top of a switch that has only just started
      if (!animate && key === last) return
      last = key

      beamRef.current?.kill()

      if (!animate) {
        gsap.set(tile, { ...to, opacity: 1, scaleX: 1, scaleY: 1 })
        gsap.set(glow, { opacity: 1 })
        setLitId(selectedId)
        return
      }

      // width and height are layout, and the columns are equal, so they are
      // only written when they genuinely changed — the crossing itself is pure
      // transform and stays off the layout path
      const resized =
        Math.abs(to.width - (gsap.getProperty(tile, "width") as number)) > 0.5 ||
        Math.abs(to.height - (gsap.getProperty(tile, "height") as number)) > 0.5

      beamRef.current = gsap
        .timeline()
        // 1. the halo lets go, while the overlay stays where it is
        .to(glow, {
          opacity: 0,
          duration: BEAM.glowOut,
          ease: "power2.in",
          overwrite: "auto",
        })
        // 2. the bare overlay crosses, easing in and out of the move so the
        //    departure and the arrival are both legible
        .to(tile, {
          x: to.x,
          y: to.y,
          ...(resized ? { width: to.width, height: to.height } : null),
          duration: BEAM.travel,
          ease: "power3.inOut",
          overwrite: "auto",
        })
        // 3. it settles: the tube it found wakes up and bursts, and the halo
        //    comes back up. All of it lives in this timeline, so a faster
        //    switch cancels it with everything else — and until one lands, the
        //    card the beam is still nearest keeps running.
        .add("landing", `-=${BEAM.overlap}`)
        .call(
          () => {
            setLitId(selectedId)
            playRipple(selectedId)
          },
          undefined,
          "landing"
        )
        .to(
          glow,
          {
            opacity: 1,
            duration: BEAM.glowIn,
            ease: "power2.out",
            overwrite: "auto",
          },
          "landing"
        )
    }

    // the very first placement is not a move, so it lands without a tween
    place(hasPlaced.current && !prefersReducedMotion())
    hasPlaced.current = true

    const observer = new ResizeObserver(() => place(false))
    observer.observe(grid)
    return () => {
      observer.disconnect()
      // the next run starts its own; on unmount this stops the last one
      beamRef.current?.kill()
    }
  }, [selectedId])

  // The snippet box is content-sized and torph animates each token's own width
  // on the same spring as its glyphs, so the border travels with the text on
  // its own — a second width tween here would run on a different curve and
  // fight it, which is what made the swap stutter.
  //
  // The parts of step 02 that come and go with the client — the install pill,
  // the footnote — are not mounted and unmounted either: they open and close
  // (see Collapse), so everything below them slides instead of jumping.

  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReducedMotion(query.matches)
    sync()
    query.addEventListener("change", sync)
    return () => query.removeEventListener("change", sync)
  }, [])

  // Load-in: the intro writes itself in, step 01 follows, the cards fade up
  // under it, the rule draws itself across, step 02 arrives line by line, and
  // the tube of the card that starts selected ripples on as the last beat.
  // Everything on the page belongs to this one timeline — anything left out of
  // it is the one element that pops in already finished.
  //
  // The markup ships at opacity 0 (see the root's className) so the server HTML
  // never paints in its un-animated state; this effect runs before the browser
  // draws, so it reveals the root in the same frame the tweens take their
  // starting values — which is what removes the flash of the finished page.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    if (prefersReducedMotion()) {
      gsap.set(root, { opacity: 1 })
      return
    }

    const ctx = gsap.context(() => {
      gsap.set(root, { opacity: 1 })
      gsap
        .timeline({ defaults: { ease: "power3.out", duration: 0.8 } })
        .from("[data-load='intro'] > *", {
          y: 28,
          opacity: 0,
          stagger: 0.09,
          clearProps: "transform,opacity",
        })
        .from(
          "[data-load='step']",
          { y: 24, opacity: 0, clearProps: "transform,opacity" },
          "-=0.55"
        )
        .from(
          "[data-load='card']",
          {
            y: 14,
            scale: 0.96,
            opacity: 0,
            duration: 0.6,
            stagger: 0.05,
            clearProps: "transform,opacity",
          },
          "-=0.6"
        )
        .from(
          highlightRef.current,
          { opacity: 0, scale: 0.94, duration: 0.5, ease: "back.out(1.7)" },
          "-=0.35"
        )
        // the rule draws from the left rather than appearing at full length
        .from(
          "[data-load='rule']",
          {
            scaleX: 0,
            opacity: 0,
            transformOrigin: "0% 50%",
            duration: 0.7,
            clearProps: "transform,opacity",
          },
          "-=0.6"
        )
        .from(
          "[data-load='detail'] > [data-load='reveal']",
          {
            y: 16,
            opacity: 0,
            duration: 0.6,
            stagger: 0.07,
            clearProps: "transform,opacity",
          },
          "-=0.5"
        )
        .call(() => playRipple(selectedId))
    }, root)

    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(selected.copyText)
    } catch {
      return
    }
    setCopied(true)
    window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="w-full bg-zinc-950 text-zinc-50">
      {/* two "shaders". #crt-ripple is the ambient one: soft turbulence
          breathing over several seconds, which is what a card uses the whole
          time it is active or hovered. #crt-wave is the select burst: 0.05 in x
          is a 20px wavelength, so three crests sit across the 60px icon box at
          once, and the stitched noise scrolls by exactly one wavelength per
          cycle so the travel is seamless. */}
      <svg aria-hidden className="pointer-events-none absolute size-0">
        <filter id="crt-ripple" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.015 0.09"
            numOctaves={2}
            seed={7}
            result="noise"
          >
            {reducedMotion ? null : (
              <animate
                attributeName="baseFrequency"
                dur="7s"
                values="0.015 0.09;0.04 0.15;0.02 0.07;0.015 0.09"
                repeatCount="indefinite"
              />
            )}
          </feTurbulence>
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={5}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* #crt-ripple's twin with no clock in it: the same noise, the same
            seed, the same displacement, frozen at the frequency the animated
            one starts from. An idle card wears this one, so its picture is the
            picture the others have — it just isn't being redrawn. */}
        <filter id="crt-still" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.015 0.09"
            numOctaves={2}
            seed={7}
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={5}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        <filter id="crt-wave" x="-50%" y="-50%" width="200%" height="200%">
          <feTurbulence
            type="turbulence"
            baseFrequency="0.05 0.012"
            numOctaves={1}
            seed={7}
            stitchTiles="stitch"
            result="wave"
          />
          <feOffset in="wave" dx={0} dy={0} result="travelling">
            {reducedMotion ? null : (
              <animate
                attributeName="dx"
                dur="1.6s"
                values="0;-20"
                repeatCount="indefinite"
              />
            )}
          </feOffset>
          <feDisplacementMap
            in="SourceGraphic"
            in2="travelling"
            scale={12}
            xChannelSelector="R"
            yChannelSelector="G"
          >
            {reducedMotion ? null : (
              <animate
                attributeName="scale"
                dur="1.6s"
                values="8;14;8"
                repeatCount="indefinite"
              />
            )}
          </feDisplacementMap>
        </filter>

        {/* the channel split, taken from the logo's own pixels: its green
            channel shifted one way, its red+blue the other, screened back over
            the original — so an orange glyph fringes warm, not green/magenta */}
        <filter id="crt-split" x="-25%" y="-25%" width="150%" height="150%">
          <feOffset in="SourceGraphic" dx={-1.5} dy={0} result="left" />
          <feColorMatrix
            in="left"
            type="matrix"
            values="0 0 0 0 0
                    0 1 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0"
            result="leftGreen"
          />
          <feOffset in="SourceGraphic" dx={1.5} dy={0} result="right" />
          <feColorMatrix
            in="right"
            type="matrix"
            values="1 0 0 0 0
                    0 0 0 0 0
                    0 0 1 0 0
                    0 0 0 1 0"
            result="rightRedBlue"
          />
          <feBlend in="leftGreen" in2="rightRedBlue" mode="screen" result="split" />
          <feBlend in="SourceGraphic" in2="split" mode="screen" />
        </filter>
      </svg>

      <div
        ref={rootRef}
        className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-14 px-6 pt-10 pb-20 opacity-0 md:px-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20 lg:pt-14 lg:pb-28"
      >
        {/* Intro */}
        <div
          data-load="intro"
          className="flex flex-col gap-5 lg:sticky lg:top-16 lg:self-start"
        >
          <p className="flex items-center gap-2.5 text-xs font-medium tracking-[0.18em] text-zinc-400 uppercase">
            <span className="h-px w-6 bg-zinc-700" />
            Connect
          </p>
          <h2 className="font-heading text-4xl leading-[1.1] font-semibold tracking-tight text-balance lg:text-5xl">
            Three steps from client to credit.
          </h2>
          <p className="max-w-sm text-base leading-relaxed text-zinc-400">
            Add Mode MCP to your agent of choice. One public endpoint gives it a
            direct interface to Mode V3 and V4.
          </p>
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-12">
          <div data-load="step" className="flex flex-col gap-6">
            <StepHeading number="01" title="Choose your client" />

            <div ref={gridRef} className="relative grid grid-cols-2 gap-3 sm:grid-cols-3">
              {/* The selection is a beam, not a state. Every card is lit the
                  same the whole time; this sits *over* them and brightens
                  whatever is under it, so what moves between cards is the
                  light itself — nothing switches on, nothing goes dark.
                  Position, size and opacity all belong to GSAP from here on. */}
              <span
                ref={highlightRef}
                aria-hidden
                className="pointer-events-none absolute top-0 left-0 z-20 rounded-[calc(var(--radius)*1.8+1px)] bg-zinc-100/[0.06] opacity-0 backdrop-brightness-[1.55] backdrop-saturate-[1.2] will-change-transform"
              >
                {/* the halo is its own layer so it can let go and come back
                    without touching the overlay that is carrying it */}
                <span
                  ref={glowRef}
                  className="absolute inset-0 rounded-[inherit] shadow-[0_0_28px_-8px_rgba(255,255,255,0.28)]"
                />
              </span>

              {clients.map((client) => {
                const isSelected = client.id === selected.id
                const isRunning = client.id === litId
                const setBurstRef = (node: HTMLSpanElement | null) => {
                  if (node) burstRefs.current.set(client.id, node)
                  else burstRefs.current.delete(client.id)
                }

                return (
                  <button
                    key={client.id}
                    ref={(node) => {
                      if (node) cardRefs.current.set(client.id, node)
                      else cardRefs.current.delete(client.id)
                    }}
                    data-load="card"
                    data-active={isSelected}
                    data-running={isRunning}
                    type="button"
                    onClick={() => select(client.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      // Every card wears exactly the same surface, selected or
                      // not — the beam above the grid is what tells them apart.
                      // Hover is the only thing that changes here, and it is an
                      // answer rather than a transition, so it is quick.
                      "group relative z-10 flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-4 outline-none",
                      "ease-out-quint transition-[background-color,border-color,box-shadow] duration-300 hover:duration-150",
                      "hover:border-zinc-700 hover:bg-zinc-800/50",
                      "focus-visible:ring-2 focus-visible:ring-violet-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                    )}
                  >
                    <span
                      className={cn(
                        // it waits for the light: the delay is the beam's
                        // glow-out plus its crossing, less their overlap (see
                        // BEAM), so the check arrives as the card is lit, not
                        // on a card that is still dark. Out, it just goes.
                        "ease-spring absolute top-2.5 right-2.5 flex size-4 items-center justify-center rounded-full bg-zinc-200 text-zinc-900 transition-[transform,opacity] duration-300",
                        isSelected
                          ? "scale-100 opacity-100 delay-[550ms]"
                          : "scale-0 opacity-0 delay-0"
                      )}
                    >
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>

                    {/* The lift and the press. They live on the content, not
                        on the button: the card's own box has to stay put, since
                        the beam is measured from it. */}
                    <span className="ease-out-quint flex flex-col items-center gap-2 transition-transform duration-300 group-hover:-translate-y-0.5 group-active:translate-y-0 group-active:scale-[0.97] group-active:duration-100">
                      {/* fixed icon box: keeps cards the same height whatever the
                          glyph size, and wide enough for the glyph's bloom to
                          spill. Every tube is lit; only the one the beam is
                          sitting on is running. */}
                      <span className="relative flex size-15 items-center justify-center">
                        {client.logo ? (
                          <CrtGlyph
                            src={client.logo}
                            sizeClass={client.iconClass ?? "size-9"}
                            running={isRunning}
                            burstRef={setBurstRef}
                          />
                        ) : (
                          <CrtBlob running={isRunning} burstRef={setBurstRef} />
                        )}
                      </span>
                      <span className="text-sm font-medium text-zinc-300 transition-colors duration-300 group-hover:text-zinc-100 group-hover:duration-150">
                        {client.name}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <hr data-load="rule" className="border-zinc-800" />

          <div data-load="detail" className="flex flex-col items-start">
            <StepHeading number="02" title="Connect the MCP" />

            <p data-load="reveal" className="mt-5 text-base text-zinc-400">
              <TextMorph {...MORPH}>{selected.blurb}</TextMorph>
            </p>

            {/* the pill is never unmounted: it opens and closes, and the label,
                the snippet and the footnote slide with it */}
            <Collapse open={hasCta} className="max-w-full">
              {ctaClient ? (
                <button
                  type="button"
                  className="ease-out-quint inline-flex cursor-pointer items-center gap-3 rounded-full bg-zinc-800 px-6 py-3.5 text-base font-semibold text-zinc-50 outline-none transition-[background-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:bg-zinc-700 hover:shadow-lg hover:shadow-black/30 focus-visible:ring-2 focus-visible:ring-violet-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:translate-y-0 active:scale-[0.98] active:duration-100"
                >
                  {/* every mark that can appear here shares one slot, so
                      switching clients cross-fades rather than swapping a src */}
                  <span className="relative grid size-5 shrink-0 place-items-center">
                    {ctaClients.map((client) => (
                      <ChipMark
                        key={client.id}
                        client={client}
                        active={client.id === ctaClient.id}
                      />
                    ))}
                  </span>
                  <TextMorph {...MORPH}>{ctaClient.cta}</TextMorph>
                </button>
              ) : null}
            </Collapse>

            <p
              data-load="reveal"
              className="mt-5 text-sm font-semibold text-zinc-100"
            >
              <TextMorph {...MORPH}>{selected.snippetLabel}</TextMorph>
            </p>

            <div
              data-load="reveal"
              data-copied={copied}
              className="ease-out-quint mt-5 inline-flex max-w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 py-2 pr-2 pl-4 transition-colors duration-500 data-[copied=true]:border-emerald-500/30 data-[copied=true]:bg-emerald-500/[0.04]"
            >
              {/* the morph parks its outgoing glyphs out of flow, so they add to
                  this box's scroll area for as long as they are fading — the
                  scrollbar is hidden so that never flashes a bar under the
                  text, while the snippet stays scrollable on narrow screens */}
              <code className="min-w-0 overflow-x-auto font-mono text-sm whitespace-pre text-zinc-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {/* each token keeps its slot across clients, so the snippet
                    morphs in place instead of being swapped out */}
                {snippetSlots(selected.snippet).map((token, index) => (
                  <TextMorph
                    key={index}
                    {...MORPH}
                    className={cn(
                      // a token that changes tone fades between colours rather
                      // than repainting under the glyphs that are still moving
                      "ease-out-quint transition-colors duration-300",
                      token.tone ? toneClass[token.tone] : "text-zinc-200"
                    )}
                  >
                    {token.text}
                  </TextMorph>
                ))}
              </code>
              <button
                type="button"
                onClick={copySnippet}
                aria-label="Copy snippet"
                className="ease-out-quint flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-zinc-800/60 text-zinc-400 outline-none transition-[background-color,color,transform] duration-300 hover:bg-zinc-800 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-violet-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:scale-90 active:duration-100"
              >
                {/* both icons are always there, stacked in one grid cell: the
                    swap is a cross-fade with a quarter turn, not a cut */}
                <span aria-hidden className="grid place-items-center">
                  <Copy
                    className={cn(
                      "ease-spring col-start-1 row-start-1 size-4 transition-[transform,opacity] duration-300",
                      copied
                        ? "scale-50 -rotate-90 opacity-0"
                        : "scale-100 rotate-0 opacity-100"
                    )}
                  />
                  <Check
                    className={cn(
                      "ease-spring col-start-1 row-start-1 size-4 text-emerald-400 transition-[transform,opacity] duration-300",
                      copied
                        ? "scale-100 rotate-0 opacity-100"
                        : "scale-50 rotate-90 opacity-0"
                    )}
                  />
                </span>
              </button>
            </div>

            <Collapse open={Boolean(selected.footnote)} className="w-full">
              <p className="text-base leading-relaxed text-zinc-400">
                {footnoteSlots(footnote).map((slot, index) =>
                  slot.code ? (
                    <TextMorph
                      key={index}
                      {...MORPH}
                      as="code"
                      className={cn(
                        // an empty slot gives up its padding and its background
                        // so a chip that is morphing away doesn't leave a pill
                        "ease-out-quint rounded-md py-0.5 font-mono text-sm text-zinc-200 transition-[padding,opacity,background-color] duration-300",
                        slot.filled
                          ? "bg-zinc-800/80 px-2 opacity-100"
                          : "bg-transparent px-0 opacity-0"
                      )}
                    >
                      {slot.text}
                    </TextMorph>
                  ) : (
                    <TextMorph key={index} {...MORPH}>
                      {slot.text}
                    </TextMorph>
                  )
                )}
              </p>
            </Collapse>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * A section that comes and goes with the client, without the page jumping.
 *
 * The shell owns a real height, tweened between 0 and the content's own, so
 * everything below it slides out of the way at exactly the rate the section
 * opens — layout does the choreography, nothing has to be kept in sync by
 * hand. Once open it hands the height back to the content (`auto`), so a
 * paragraph that reflows, or a window that resizes, is never clipped, and the
 * pill's shadow is free of the clip again.
 *
 * The content crossfades on its own beat: on the way in it waits for the space
 * to exist before it appears, on the way out it leaves first and lets the space
 * close behind it.
 */
function Collapse({
  open,
  className,
  children,
}: {
  open: boolean
  className?: string
  children: ReactNode
}) {
  const shellRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const settled = useRef(false)
  /** the content height as we last saw it; -1 until the observer's first call */
  const lastHeight = useRef(-1)
  /** a window resize is a layout change, not a moment; it should not be tweened */
  const resizingUntil = useRef(0)

  const run = (toOpen: boolean, animate: boolean) => {
    const shell = shellRef.current
    const inner = innerRef.current
    if (!shell || !inner) return

    gsap.killTweensOf(shell)

    if (!animate) {
      gsap.set(shell, {
        height: toOpen ? "auto" : 0,
        overflow: toOpen ? "visible" : "hidden",
      })
      return
    }

    // from wherever it is now — an interrupted open closes from half-height
    gsap.set(shell, { height: shell.offsetHeight, overflow: "hidden" })
    gsap.to(shell, {
      height: toOpen ? inner.offsetHeight : 0,
      duration: toOpen ? 0.55 : 0.4,
      ease: toOpen ? "expo.out" : "power3.inOut",
      onComplete: () => {
        if (toOpen) gsap.set(shell, { height: "auto", overflow: "visible" })
      },
    })
  }

  useLayoutEffect(() => {
    if (!settled.current) {
      settled.current = true
      run(open, false)
      return
    }
    run(open, !prefersReducedMotion())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    const onResize = () => {
      resizingUntil.current = performance.now() + 200
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // An open section keeps following its own content. Two things need it: text
  // that morphs in after the open began would otherwise be clipped at the
  // height measured before it arrived, and a paragraph that rewraps to another
  // number of lines when the client changes would otherwise snap the whole
  // column down a line while its glyphs are still moving.
  useEffect(() => {
    const shell = shellRef.current
    const inner = innerRef.current
    if (!shell || !inner) return

    const land = () => gsap.set(shell, { height: "auto", overflow: "visible" })

    const observer = new ResizeObserver(() => {
      const previous = lastHeight.current
      const next = inner.offsetHeight
      lastHeight.current = next
      // the first measurement is a measurement, not a change
      if (!open || previous < 0) return

      // mid-open: retarget the tween that is already running
      if (shell.style.height !== "auto" && shell.style.height !== "") {
        gsap.to(shell, {
          height: next,
          duration: 0.3,
          ease: "power2.out",
          overwrite: true,
          onComplete: land,
        })
        return
      }

      // Settled at auto: the content just changed shape under us. The observer
      // runs after layout but before paint, so taking the old height back here
      // and running it to the new one is never seen as a jump.
      if (
        Math.abs(next - previous) < 1 ||
        prefersReducedMotion() ||
        performance.now() < resizingUntil.current
      ) {
        return
      }

      gsap.set(shell, { height: previous, overflow: "hidden" })
      gsap.to(shell, {
        height: next,
        duration: 0.4,
        ease: "power3.out",
        overwrite: true,
        onComplete: land,
      })
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [open])

  return (
    <div
      ref={shellRef}
      data-load={open ? "reveal" : undefined}
      aria-hidden={open ? undefined : true}
      inert={!open}
      className={cn("h-0 overflow-hidden", className)}
    >
      <div
        ref={innerRef}
        className={cn(
          "ease-out-quint pt-5 transition-[opacity,transform,filter]",
          open
            ? "translate-y-0 opacity-100 blur-[0px] delay-100 duration-500"
            : "-translate-y-1 opacity-0 blur-[2px] delay-0 duration-200"
        )}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * The logos are multi-coloured, so they're masked to a flat white glyph to sit
 * on the dark pill — unless the client ships a white mark of its own, which
 * goes in untouched. Every mark stays mounted in the same grid cell and only
 * the active one is lit, so a client swap dissolves through focus instead of
 * replacing an image.
 */
function ChipMark({ client, active }: { client: Client; active: boolean }) {
  const className = cn(
    "ease-out-quint col-start-1 row-start-1 shrink-0 transition-[opacity,transform,filter] duration-300",
    client.chipIconClass ?? "size-5",
    active ? "scale-100 opacity-100 blur-[0px]" : "scale-75 opacity-0 blur-[2px]"
  )

  if (client.chipLogo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={client.chipLogo} alt="" aria-hidden className={className} />
  }

  return (
    <span
      aria-hidden
      style={{
        maskImage: `url(${client.logo})`,
        maskSize: "contain",
        maskPosition: "center",
        maskRepeat: "no-repeat",
      }}
      className={cn(className, "bg-zinc-50")}
    />
  )
}

/**
 * The shadow mask, as a mask rather than a coat of black bars: the lit picture
 * is cut into phosphor cells, so the gaps between them are the dark card
 * showing through. Vertical grille × horizontal scan pitch, both ramping
 * instead of stepping so the cells are soft-edged, and the horizontal pass
 * never closes fully — a scan line dims the cell, it doesn't erase it.
 */
const CELL_MASK: CSSProperties = {
  maskImage:
    "repeating-linear-gradient(90deg, transparent 0px, #000 1px, #000 2.2px, transparent 3.2px), repeating-linear-gradient(0deg, rgba(0,0,0,0.45) 0px, #000 1.2px, #000 2.6px, rgba(0,0,0,0.45) 3.8px)",
  maskComposite: "intersect",
}

/** phosphor triads: each cell the light lands on takes an RGB tint */
const TRIADS =
  "bg-[repeating-linear-gradient(90deg,rgba(255,70,70,0.28)_0px,rgba(70,255,150,0.28)_1.1px,rgba(90,150,255,0.28)_2.1px,rgba(255,70,70,0.28)_3.2px)]"

const RIPPLE_LINES =
  "bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.5)_0px,rgba(255,255,255,0.5)_2px,transparent_2px,transparent_10px)]"

const BLOB =
  "animate-blob rounded-2xl bg-gradient-to-br from-zinc-100 via-zinc-400 to-zinc-600"

/**
 * An idle tube is held, not stripped: the animation stays on the element and
 * keeps drawing the frame it is on, so the shape a card shows is the shape it
 * had. Removing the animation instead would snap the blob back to a rounded
 * square and the scan lines back to their first offset.
 */
const HELD = "[animation-play-state:paused]"

/**
 * The tube itself. It is lit on every card, always — but only the running
 * card's picture is being redrawn: the tracking glitch, the rolling scan lines
 * and the turbulence warp all stop on the cards the beam is not on. The outer
 * layer is the one GSAP owns — it only touches it for the burst when a card is
 * picked. Whatever is passed in is what gets scanned.
 */
function CrtTube({
  running,
  burstRef,
  children,
}: {
  running: boolean
  burstRef: (node: HTMLSpanElement | null) => void
  children: ReactNode
}) {
  return (
    <span ref={burstRef} className="absolute inset-0">
      <span
        className={cn(
          "absolute inset-0",
          // the glitch is dropped rather than held: its rest frame is the
          // identity it already has, so there is nothing to freeze, and a
          // paused one could sit forever on a torn frame
          running
            ? "animate-crt-glitch [filter:url(#crt-ripple)]"
            : "[filter:url(#crt-still)]"
        )}
      >
        {children}
      </span>
    </span>
  )
}

/**
 * "Everything else": the morphing gradient blob, scanned through the same tube.
 * Its overlays are clipped by the blob's own shape rather than an image mask.
 */
function CrtBlob({
  running,
  burstRef,
}: {
  running: boolean
  burstRef: (node: HTMLSpanElement | null) => void
}) {
  return (
    <span className="relative size-9">
      <CrtTube running={running} burstRef={burstRef}>
        <span aria-hidden className="absolute -inset-3 isolate" style={CELL_MASK}>
          <span className="absolute inset-3">
            {/* the blob's own halo, blurred out past its edges */}
            <span
              className={cn(
                BLOB,
                "absolute inset-0 scale-110 opacity-80 blur-[5px]",
                !running && HELD
              )}
            />
            <span
              className={cn(
                BLOB,
                "absolute inset-0 overflow-hidden [filter:url(#crt-split)_brightness(1.12)_saturate(1.25)_drop-shadow(0_0_6px_rgba(255,255,255,0.4))]",
                !running && HELD
              )}
            >
              <span className={cn("absolute inset-0 mix-blend-color-dodge", TRIADS)} />
              <span
                className={cn(
                  "animate-crt-ripple absolute inset-0 mix-blend-overlay",
                  RIPPLE_LINES,
                  !running && HELD
                )}
              />
            </span>
          </span>
        </span>
      </CrtTube>
    </span>
  )
}

/**
 * A logo re-scanned through a CRT: its own light blooming past its edges, the
 * whole lit picture then cut into phosphor cells by the shadow mask, a channel
 * split taken from its own colours and rolling ripple lines, all warped by the
 * animated turbulence filter.
 */
function CrtGlyph({
  src,
  sizeClass,
  running,
  burstRef,
}: {
  src: string
  sizeClass: string
  running: boolean
  burstRef: (node: HTMLSpanElement | null) => void
}) {
  const solid: CSSProperties = {
    maskImage: `url(${src})`,
    maskSize: "contain",
    maskPosition: "center",
    maskRepeat: "no-repeat",
  }

  return (
    <span className={cn("relative", sizeClass)}>
      <CrtTube running={running} burstRef={burstRef}>
        {/* the lit screen. The cell mask is carried by this wrapper, not
            painted over the logo, so it cuts the bloom as well as the glyph
            and the gaps stay card-dark. It sits wider than the glyph so the
            halo has somewhere to spill before the mask box ends. */}
        <span aria-hidden className="absolute -inset-3 isolate" style={CELL_MASK}>
          <span className="absolute inset-3">
            {/* the halo: a blurred, slightly oversized copy of the glyph, so
                light reaches the cells around it instead of stopping at the
                logo's own outline */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              className="absolute inset-0 size-full scale-110 object-contain opacity-80 blur-[5px]"
            />
            {/* the logo itself, in its own colours, channel-split by the
                filter above and blooming */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              className="absolute inset-0 size-full object-contain [filter:url(#crt-split)_brightness(1.12)_saturate(1.25)_drop-shadow(0_0_6px_rgba(255,255,255,0.4))]"
            />
            {/* triads dodge the cells the glyph lands on, glyph-shaped so the
                tint never colours the empty screen */}
            <span
              aria-hidden
              style={solid}
              className={cn("absolute inset-0 mix-blend-color-dodge", TRIADS)}
            />
          </span>
        </span>
        {/* ripple lines rolling down, glyph-shaped so nothing paints outside
            the logo; overlay rather than screen, so they brighten the glyph's
            own colour instead of washing it to white */}
        <span
          aria-hidden
          style={solid}
          className={cn(
            "animate-crt-ripple absolute inset-0 mix-blend-overlay",
            RIPPLE_LINES,
            !running && HELD
          )}
        />
      </CrtTube>
    </span>
  )
}

function StepHeading({ number, title }: { number: string; title: string }) {
  return (
    <div data-load="reveal" className="flex items-baseline gap-3">
      <span className="font-mono text-lg font-bold tracking-wider text-violet-400 tabular-nums">
        {number}
      </span>
      <span className="text-lg font-semibold text-violet-400/70">/</span>
      <h3 className="font-heading text-xl font-semibold tracking-tight text-zinc-50">
        {title}
      </h3>
    </div>
  )
}
