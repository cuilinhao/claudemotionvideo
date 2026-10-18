import { useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  Copy,
  Download,
  Film,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Play,
  Scissors,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { api, type User } from "./lib/api";
import { effects, plans, templateData } from "./lib/content";
import type { AuthMode, Plan } from "./lib/ui-types";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link
      to="/"
      className={`brand ${small ? "brand-small" : ""}`}
      aria-label="Claude Motion Video home"
    >
      <span className="brand-mark">
        <span />
      </span>
      <span>
        Claude<span className="brand-light">Motion</span>
      </span>
    </Link>
  );
}
function Header({
  user,
  onAuth,
  onLogout,
}: {
  user: User | null;
  onAuth: (m: AuthMode) => void;
  onLogout: () => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <header className="site-header">
      <Brand />
      <nav className={`main-nav ${menu ? "nav-open" : ""}`}>
        <NavLink to="/studio">Studio</NavLink>
        <NavLink to="/pricing">Pricing</NavLink>
        <NavLink to="/blogs">Blogs</NavLink>
      </nav>
      <div className="header-actions">
        {user ? (
          <>
            <span className="credit-pill">
              <Sparkles size={13} />
              {user.credits.toLocaleString()} <small>credits</small>
            </span>
            <button className="avatar" title={user.email} onClick={onLogout}>
              {user.email.slice(0, 1).toUpperCase()}
            </button>
          </>
        ) : (
          <button className="sign-in" onClick={() => onAuth("login")}>
            Sign in <ArrowUpRight size={14} />
          </button>
        )}
        <button
          className="mobile-menu"
          onClick={() => setMenu(!menu)}
          aria-label="Toggle menu"
        >
          {menu ? <X /> : <Menu />}
        </button>
      </div>
    </header>
  );
}
function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <Brand />
        <p>Make your idea move.</p>
      </div>
      <div className="footer-links">
        <div>
          <strong>MAKE</strong>
          <Link to="/studio">Studio</Link>
          <Link to="/examples">Examples</Link>
          <Link to="/effects">Effects</Link>
        </div>
        <div>
          <strong>RESOURCES</strong>
          <Link to="/pricing">Pricing</Link>
          <Link to="/blogs">Blogs</Link>
          <Link to="/contact">Contact</Link>
        </div>
        <div>
          <strong>LEGAL</strong>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/refund">Refunds</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Claude Motion Video</span>
        <span>Made with Claude</span>
      </div>
    </footer>
  );
}
export function SiteLayout({
  children,
  user,
  onAuth,
  onLogout,
}: {
  children: React.ReactNode;
  user: User | null;
  onAuth: (m: AuthMode) => void;
  onLogout: () => void;
}) {
  return (
    <>
      <Header user={user} onAuth={onAuth} onLogout={onLogout} />
      {children}
      <Footer />
    </>
  );
}

function ArtCard({
  index = 0,
  label = "MOTION STUDY",
  className = "",
}: {
  index?: number;
  label?: string;
  className?: string;
}) {
  const variants = [
    "art-orange",
    "art-lime",
    "art-blue",
    "art-violet",
    "art-sand",
    "art-red",
  ];
  return (
    <div
      className={`art-card ${variants[index % variants.length]} ${className}`}
    >
      <div className="art-top">
        <span>{label}</span>
        <span>CMV—0{index + 1}</span>
      </div>
      <div className="art-grid" />
      <svg
        className="art-graphic"
        viewBox="0 0 500 320"
        role="img"
        aria-label="Original abstract motion graphics preview"
      >
        <defs>
          <linearGradient id={`g${index}`} x1="0" x2="1" y1="0" y2="1">
            <stop stopColor="currentColor" />
            <stop offset="1" stopColor="white" stopOpacity=".15" />
          </linearGradient>
          <filter id={`shadow${index}`} x="-.5" y="-.5" width="2" height="2">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>
        <ellipse
          cx="253"
          cy="164"
          rx="132"
          ry="88"
          fill="currentColor"
          opacity=".26"
          filter={`url(#shadow${index})`}
        />
        <path
          d="M130 215 238 58l118 162-99 44z"
          fill={`url(#g${index})`}
          opacity=".87"
        />
        <path d="m145 207 89-122-17 166-71-44Z" fill="white" opacity=".33" />
        <circle
          cx="327"
          cy="115"
          r="36"
          fill="none"
          stroke="white"
          strokeWidth="2"
          opacity=".85"
        />
        <circle
          cx="327"
          cy="115"
          r="22"
          fill="none"
          stroke="white"
          strokeWidth="1"
          opacity=".6"
        />
        <path
          d="M80 246h340M108 230l-20 16 20 16M393 230l20 16-20 16"
          stroke="white"
          strokeWidth="1"
          opacity=".48"
        />
        <text
          x="47"
          y="67"
          fill="white"
          fontSize="11"
          fontFamily="monospace"
          letterSpacing="3"
        >
          FORM / 01
        </text>
        <text
          x="362"
          y="256"
          fill="white"
          fontSize="10"
          fontFamily="monospace"
          letterSpacing="2"
        >
          1080P
        </text>
      </svg>
      <div className="art-bottom">
        <span>FRAME {String(index + 1).padStart(2, "0")} — 30 FPS</span>
        <span>
          <span className="live-dot" /> RENDER READY
        </span>
      </div>
    </div>
  );
}
function SectionHead({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {body && <p className="section-body">{body}</p>}
      </div>
      {action}
    </div>
  );
}

function DemoCard({ compact = false }: { compact?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) await video.play();
    else video.pause();
  }

  return (
    <div className={`demo-card ${compact ? "demo-card-compact" : ""}`}>
      <div className="demo-card-top">
        <span>CLAUDE MOTION VIDEO / STUDIO</span>
        <span className="demo-record">
          <i /> REAL GENERATED VIDEO
        </span>
      </div>
      <div className="demo-frame">
        <div className="demo-source">
          <span className="demo-source-label">INPUT IMAGE</span>
          <img
            src="/demos/orbit-input.png"
            alt="Orbit dashboard screenshot used as the video input"
          />
        </div>
        <span className="demo-transform" aria-hidden="true">
          →
        </span>
        <div className="demo-output">
          <span className="demo-source-label">MP4 PREVIEW</span>
          <video
            ref={videoRef}
            src="/demos/orbit-demo.mp4"
            poster="/demos/orbit-poster.jpg"
            autoPlay
            muted
            loop
            playsInline
            controls
            aria-label="Generated Orbit dashboard motion graphics video"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <button
            className="demo-play-control"
            type="button"
            onClick={() => void togglePlayback()}
            aria-label={playing ? "Pause video demo" : "Play video demo"}
            aria-pressed={playing}
          >
            {playing ? "PAUSE" : "PLAY"}
          </button>
        </div>
      </div>
      <div className="demo-card-foot">
        <span>ORBIT / PRODUCT MOTION</span>
        <span>H.264 MP4 · 1080P · 30 FPS</span>
      </div>
    </div>
  );
}

export function HomePage({
  user,
  onAuth,
}: {
  user: User | null;
  onAuth: (m: AuthMode) => void;
}) {
  return (
    <main className="home-page">
      <section className="hero wrap">
        <div className="hero-copy">
          <div className="eyebrow hero-kicker">
            <span className="live-dot" /> AI MOTION GRAPHICS GENERATOR{" "}
            <span className="mono">01 / 26</span>
          </div>
          <h1>
            AI motion
            <br />
            graphics
            <br />
            <span className="hero-hot">you can edit</span>
            <br />
            precisely.
          </h1>
          <p className="hero-intro">
            From a screenshot or a sentence, create motion graphics you can edit
            precisely. Change any part, and only that part moves.
          </p>
          <div className="hero-buttons">
            <Link className="button button-primary" to="/studio">
              Try it in the studio <ArrowRight size={16} />
            </Link>
            <Link className="button button-quiet" to="/examples">
              Browse examples <ArrowDown size={15} />
            </Link>
          </div>
          <div className="hero-specs">
            <span>
              <Sparkles size={14} /> Claude-powered
            </span>
            <span>16:9 · 9:16 · 1:1</span>
            <span>Up to 30 sec</span>
            <span>1080p MP4</span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="visual-corner corner-tl" />
          <div className="visual-corner corner-br" />
          <DemoCard />
          <span className="hero-index">FIG. 001 / CMV STUDIO</span>
        </div>
      </section>
      <section className="ticker">
        <div>
          SCREENSHOT TO MOTION <b>✳</b> EDIT BY CHAT <b>✳</b> PIXEL-PRECISE
          TYPE <b>✳</b> EVERY FRAME IS CODE <b>✳</b> SCREENSHOT TO MOTION{" "}
          <b>✳</b> EDIT BY CHAT <b>✳</b>
        </div>
      </section>
      <section className="wrap section templates-section">
        <SectionHead
          eyebrow="01 / START WITH A DIRECTION"
          title={"A starting point,\nnot a blank page."}
          body="Choose a format. Bring your own image, or start with a thought."
          action={
            <Link className="text-link" to="/studio">
              Explore templates <ArrowRight size={15} />
            </Link>
          }
        />
        <div className="template-grid">
          {templateData.slice(0, 6).map((t, i) => (
            <Link
              key={t.name}
              to={`/studio?template=${encodeURIComponent(t.name)}`}
              className="template-card"
            >
              <ArtCard
                index={i + 1}
                label={t.category.toUpperCase()}
                className="template-art"
              />
              <div className="template-meta">
                <div>
                  <h3>{t.name}</h3>
                  <p>{t.desc}</p>
                </div>
                <span className="format-tag">
                  {t.aspect} · {t.duration}s
                </span>
              </div>
              <span className="card-arrow">
                <ArrowUpRight size={17} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="precision-band">
        <div className="wrap precision-grid">
          <div>
            <p className="eyebrow">02 / A DIFFERENT KIND OF VIDEO</p>
            <h2>
              Your design,
              <br />
              <span>still yours.</span>
            </h2>
          </div>
          <div className="precision-points">
            <article>
              <span>01</span>
              <div>
                <h3>Change it, don’t reroll it.</h3>
                <p>
                  Ask for a small change. Only the part you named moves, while
                  every version stays ready to compare.
                </p>
              </div>
            </article>
            <article>
              <span>02</span>
              <div>
                <h3>Keep the details sharp.</h3>
                <p>
                  Your screenshot, real text and brand colours become the motion
                  graphics. No re-painted UI or fuzzy type.
                </p>
              </div>
            </article>
            <article>
              <span>03</span>
              <div>
                <h3>Every frame is code.</h3>
                <p>
                  Claude writes the timing, typography and movement. Preview in
                  the studio and export a crisp MP4.
                </p>
              </div>
            </article>
          </div>
        </div>
      </section>
      <section className="wrap section how-section">
        <SectionHead
          eyebrow="03 / THREE SIMPLE STEPS"
          title="From still to story."
        />
        <div className="step-grid">
          <article>
            <span>01 — INPUT</span>
            <div className="step-icon">
              <ImagePlus />
            </div>
            <h3>
              Bring an image
              <br />
              or a sentence.
            </h3>
            <p>
              Drop in a product shot, app screen or poster. Tell us what should
              move.
            </p>
          </article>
          <article>
            <span>02 — GENERATE</span>
            <div className="step-icon">
              <WandSparkles />
            </div>
            <h3>
              Watch the
              <br />
              storyboard unfold.
            </h3>
            <p>
              Claude turns your idea into shots, then writes each scene as code.
            </p>
          </article>
          <article>
            <span>03 — REFINE</span>
            <div className="step-icon">
              <Scissors />
            </div>
            <h3>
              Make it yours.
              <br />
              Then export.
            </h3>
            <p>
              Refine by chat, choose a shot, compare versions and download a
              1080p MP4.
            </p>
          </article>
        </div>
      </section>
      <section className="effects-band">
        <div className="wrap">
          <SectionHead
            eyebrow="04 / FIND YOUR MOTION"
            title="Good movement has a name."
            body="Explore small details that make the whole thing feel considered."
            action={
              <Link className="text-link" to="/effects">
                Browse effects <ArrowRight size={15} />
              </Link>
            }
          />
          <div className="effect-chips">
            {effects.slice(0, 6).map((e, i) => (
              <Link
                className="effect-chip"
                to={`/studio?prompt=${encodeURIComponent(e[2])}`}
                key={e[0]}
              >
                <span>0{i + 1}</span>
                <strong>{e[0]}</strong>
                <ArrowUpRight size={15} />
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section className="wrap section showcase-section">
        <SectionHead
          eyebrow="05 / ORIGINAL MOTION STUDIES"
          title="Ideas in motion."
          body="A small collection of original visual studies made for this studio."
          action={
            <Link className="text-link" to="/examples">
              All examples <ArrowRight size={15} />
            </Link>
          }
        />
        <div className="showcase-grid">
          {[0, 1, 2].map((i) => (
            <Link
              className="showcase-card"
              to={`/studio?template=${encodeURIComponent(["App launch", "Lucky spin ad", "Data story"][i])}`}
              key={i}
            >
              <ArtCard
                index={i + 2}
                label={["PRODUCT STUDY", "SOCIAL STUDY", "DATA STUDY"][i]}
              />
              <div className="showcase-meta">
                <h3>
                  {
                    [
                      "A quiet introduction",
                      "The moment before",
                      "Numbers, with rhythm",
                    ][i]
                  }
                </h3>
                <span>
                  OPEN STUDY <ArrowUpRight size={14} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <section className="wrap section home-pricing-section">
        <SectionHead
          eyebrow="06 / CLEAR, MONTHLY PLANS"
          title="Start with room to make."
          body="Every plan includes 1080p MP4 exports and monthly credits."
          action={
            <Link className="text-link" to="/pricing">
              Compare all plans <ArrowRight size={15} />
            </Link>
          }
        />
        <div className="home-plan-grid">
          {plans.map((plan) => (
            <article className="home-plan" key={plan.id}>
              <span className="home-plan-name">{plan.name}</span>
              <p>
                <strong>${plan.monthly.toFixed(2)}</strong>
                <small> / month</small>
              </p>
              <span>
                {plan.credits} credits · about {plan.videos} 15-sec videos
              </span>
              <Link to="/pricing" className="text-link">
                View plan <ArrowRight size={14} />
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section className="wrap section home-faq-section">
        <SectionHead
          eyebrow="07 / FREQUENTLY ASKED"
          title="A few useful details."
        />
        <div className="home-faq-grid">
          <details>
            <summary>What can I use as a starting point?</summary>
            <p>
              Upload up to four PNG, JPEG or WebP images, or start with a
              written motion brief.
            </p>
          </details>
          <details>
            <summary>How does a video get made?</summary>
            <p>
              Your brief and images guide generated animation code. Preview it
              in the studio, refine a selected shot, then export a 1080p H.264
              MP4.
            </p>
          </details>
          <details>
            <summary>Can I keep editing after generation?</summary>
            <p>
              Yes. Ask for a change, select a shot when you want to focus the
              edit, and switch between saved versions.
            </p>
          </details>
          <details>
            <summary>How many credits does a generation use?</summary>
            <p>
              Cost depends on video length and reference images. The pricing
              page lists the current credit schedule.
            </p>
          </details>
        </div>
      </section>
      <section className="home-cta">
        <div className="wrap home-cta-inner">
          <p className="eyebrow">READY WHEN YOU ARE</p>
          <h2>
            A still image is
            <br />
            just the first frame.
          </h2>
          <Link className="button button-primary" to="/studio">
            Start making <ArrowRight size={16} />
          </Link>
          <div className="cta-orbit orbit-one" />
          <div className="cta-orbit orbit-two" />
        </div>
      </section>
    </main>
  );
}

export function PricingPage({
  user,
  onAuth,
  billingEnabled,
}: {
  user: User | null;
  onAuth: (m: AuthMode) => void;
  billingEnabled: boolean;
}) {
  const [yearly, setYearly] = useState(false);
  const [loading, setLoading] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  async function buy(plan: Plan) {
    setError("");
    if (!user) {
      onAuth("register");
      return;
    }
    if (!billingEnabled) {
      setError("Checkout is not available yet. Please try again later.");
      return;
    }
    setLoading(plan);
    try {
      const r = await api.checkout(plan, yearly ? "year" : "month");
      window.location.assign(r.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout.");
    } finally {
      setLoading(null);
    }
  }
  return (
    <main className="wrap content-page pricing-page">
      <div className="page-title">
        <p className="eyebrow">PLANS / 2026</p>
        <h1>
          Room to make
          <br />
          <span className="text-outline">more.</span>
        </h1>
        <p>
          Credits refill every month. Unused credits roll over, up to twice your
          monthly amount.
        </p>
        <div className="billing-toggle">
          <button
            className={!yearly ? "active" : ""}
            onClick={() => setYearly(false)}
          >
            Monthly
          </button>
          <button
            className={yearly ? "active" : ""}
            onClick={() => setYearly(true)}
          >
            Yearly <span>UP TO −50%</span>
          </button>
        </div>
      </div>
      {error && <div className="inline-error">{error}</div>}
      <div className="plans-grid">
        {plans.map((p) => (
          <article
            key={p.id}
            className={`plan-card ${p.popular ? "plan-popular" : ""}`}
          >
            {p.popular && <div className="popular-flag">MOST POPULAR</div>}
            <div className="plan-top">
              <span className="plan-name">{p.name}</span>
              <span className="plan-icon">
                <Sparkles size={15} />
              </span>
            </div>
            <div className="plan-price">
              ${yearly ? p.yearly : p.monthly}
              <small>/ month</small>
            </div>
            <p className="plan-bill">
              {yearly
                ? `Billed yearly at $${p.total}`
                : "Billed monthly · cancel any time"}
            </p>
            <div className="plan-credits">
              <strong>{p.credits}</strong>
              <span>credits / month</span>
            </div>
            <p className="plan-videos">
              About {p.videos} videos / month <small>(15 sec each)</small>
            </p>
            <ul>
              <li>
                <Check size={15} /> 1080p MP4, no watermark
              </li>
              <li>
                <Check size={15} /> Every scene type and effect
              </li>
              <li>
                <Check size={15} /> Commercial use
              </li>
              {p.id !== "starter" && (
                <li>
                  <Check size={15} /> Lower cost per video
                </li>
              )}
            </ul>
            <button
              className={`button ${p.popular ? "button-primary" : "button-outline"} full`}
              onClick={() => void buy(p.id)}
              disabled={loading !== null}
            >
              {loading === p.id ? (
                <LoaderCircle size={16} className="spin" />
              ) : null}
              {user?.plan === p.id ? "Current plan" : "Choose " + p.name}
              <ArrowRight size={15} />
            </button>
            <p className="plan-note">
              {!yearly ? "3-day free trial · 300 credits" : ""}
            </p>
          </article>
        ))}
      </div>
      <div className="pricing-foot">
        <LockKeyhole size={15} />
        <span>
          Secure checkout by Stripe. Payment methods vary by region and
          eligibility.
        </span>
      </div>
      <div className="pricing-faq">
        <SectionHead
          eyebrow="GOOD TO KNOW"
          title="Credits, simply explained."
        />
        <div className="faq-grid">
          <article>
            <h3>How much does a video cost?</h3>
            <p>
              10 seconds costs 80 credits, 15 seconds 100, and 30 seconds 160.
              Chat edits are 20 credits.
            </p>
          </article>
          <article>
            <h3>How do image uploads count?</h3>
            <p>
              Use up to four images. The first adds 60 credits and each
              additional image adds 20.
            </p>
          </article>
          <article>
            <h3>What if a generation fails?</h3>
            <p>
              If a generation fails on our side or Claude cannot create the
              request, credits return automatically.
            </p>
          </article>
          <article>
            <h3>Can I change or cancel?</h3>
            <p>
              You can change your plan or cancel any time. Your current plan
              stays active to the end of its paid period.
            </p>
          </article>
          <article>
            <h3>How does the trial work?</h3>
            <p>
              Monthly plans begin with 3 days and 300 credits. Add a card; your
              plan renews on day four unless cancelled.
            </p>
          </article>
          <article>
            <h3>Can I use videos commercially?</h3>
            <p>
              Yes. Videos are yours to use for lawful commercial work on every
              plan.
            </p>
          </article>
        </div>
        <p className="fine-print">
          Unused credits roll over up to 2× your monthly plan credits. Failed
          generations return credits automatically. For subscription charge
          questions, contact support; cancel before renewal to stop the next
          charge. <Link to="/refund">Refund details</Link>.
        </p>
      </div>
    </main>
  );
}

export function ExamplesPage() {
  return (
    <main className="wrap content-page">
      <div className="page-title">
        <p className="eyebrow">ORIGINAL MOTION STUDIES / 2026</p>
        <h1>
          Ideas in
          <br />
          <span className="text-outline">motion.</span>
        </h1>
        <p>
          Each study is an original starting point. Open one in the studio and
          make it your own.
        </p>
      </div>
      <div className="examples-grid">
        {templateData.map((t, i) => (
          <Link
            className="example-card"
            key={t.name}
            to={`/studio?template=${encodeURIComponent(t.name)}`}
          >
            {i === 0 ? (
              <DemoCard compact />
            ) : (
              <ArtCard
                index={i}
                label={`${t.category.toUpperCase()} / STUDY`}
              />
            )}
            <div className="example-meta">
              <div>
                <span>
                  {t.category} · {t.aspect} · {t.duration}s
                </span>
                <h3>
                  {
                    [
                      "A quiet introduction",
                      "Interfaces in motion",
                      "A moment of anticipation",
                      "Time is running",
                      "Print, with a pulse",
                      "A chart becomes a story",
                      "Light meets identity",
                      "A real voice",
                      "New details emerge",
                      "Notes on movement",
                      "One idea at a time",
                      "A little more play",
                    ][i]
                  }
                </h3>
              </div>
              <ArrowUpRight size={16} />
            </div>
            <p>{t.desc}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}

export function EffectsPage() {
  const [copied, setCopied] = useState("");
  return (
    <main className="wrap content-page">
      <div className="page-title">
        <p className="eyebrow">MOTION LIBRARY / 08 EFFECTS</p>
        <h1>
          Give it a<br />
          <span className="text-outline">little rhythm.</span>
        </h1>
        <p>
          See an effect, find the words for it, then use it in your own prompt.
        </p>
      </div>
      <div className="effects-list">
        {effects.map((e, i) => (
          <article key={e[0]} className="effect-row">
            <span className="effect-no">0{i + 1}</span>
            <div className="effect-preview">
              <span
                className="effect-demo-word"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                {
                  [
                    "MOVE",
                    "RISE",
                    "HELLO",
                    "SHIFT",
                    "BOUNCE",
                    "ECHO",
                    "READY",
                    "NEXT",
                  ][i]
                }
              </span>
              <span className="effect-kind">{e[3]}</span>
            </div>
            <div className="effect-info">
              <h2>{e[0]}</h2>
              <p>{e[1]}</p>
              <code>{e[2]}</code>
            </div>
            <div className="effect-actions">
              <button
                className="icon-button"
                onClick={async () => {
                  await navigator.clipboard.writeText(e[2]);
                  setCopied(e[0]);
                  setTimeout(() => setCopied(""), 1600);
                }}
                aria-label="Copy prompt"
              >
                {copied === e[0] ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <Link
                className="text-link"
                to={`/studio?prompt=${encodeURIComponent(e[2])}`}
              >
                Use effect <ArrowUpRight size={15} />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

const articles = [
  {
    slug: "writing-a-motion-brief",
    category: "GUIDE · 8 MIN",
    title: "Writing a motion brief that keeps your product intact",
    date: "October 12, 2026",
    excerpt:
      "A useful motion brief starts with what must stay still, then names the small things that should move.",
  },
  {
    slug: "from-screen-to-story",
    category: "WORKFLOW · 6 MIN",
    title: "From one screen to a short product story",
    date: "October 06, 2026",
    excerpt:
      "A practical way to turn an app screen into three clear beats: context, action and payoff.",
  },
  {
    slug: "small-movements",
    category: "NOTES · 5 MIN",
    title: "Small movements, sharper interfaces",
    date: "September 28, 2026",
    excerpt:
      "Why easing, timing and restraint matter when the original interface is the thing you want people to see.",
  },
  {
    slug: "social-formats",
    category: "GUIDE · 7 MIN",
    title: "Choosing a format before you choose a cut",
    date: "September 17, 2026",
    excerpt:
      "Frame the message for a feed, a product page or a square canvas before you start animating.",
  },
];
export function BlogsPage() {
  return (
    <main className="wrap content-page">
      <div className="page-title">
        <p className="eyebrow">FIELD NOTES / STUDIO JOURNAL</p>
        <h1>
          Make a note
          <br />
          <span className="text-outline">of it.</span>
        </h1>
        <p>Guides and ideas for making precise motion graphics with Claude.</p>
      </div>
      <div className="blog-list">
        {articles.map((a, i) => (
          <Link to={`/blogs/${a.slug}`} className="blog-row" key={a.slug}>
            <span className="blog-no">0{i + 1}</span>
            <div className="blog-visual">
              <ArtCard index={i + 3} label={a.category} />
            </div>
            <div className="blog-content">
              <span className="eyebrow">
                {a.category} <i>·</i> {a.date}
              </span>
              <h2>{a.title}</h2>
              <p>{a.excerpt}</p>
              <span className="text-link">
                Read article <ArrowRight size={15} />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
export function ArticlePage() {
  const { slug } = useParams();
  const article = articles.find((x) => x.slug === slug) ?? articles[0];
  return (
    <main className="wrap content-page article-page">
      <Link to="/blogs" className="text-link back-link">
        <ArrowLeft size={15} /> All notes
      </Link>
      <p className="eyebrow">
        {article.category} · {article.date}
      </p>
      <h1>{article.title}</h1>
      <p className="article-lede">{article.excerpt}</p>
      <ArtCard
        index={3}
        label="STUDIO NOTE / ORIGINAL ARTWORK"
        className="article-hero"
      />
      <div className="article-body">
        <p>
          A strong motion piece starts with a clear point of view. Before
          choosing a transition, decide what the viewer should notice first and
          what should remain familiar.
        </p>
        <h2>Keep the source recognizable</h2>
        <p>
          When your product interface is part of the story, preserve the
          original labels, colours and layout. Use motion to direct attention: a
          gentle shift, a highlighted detail, or a single moment of emphasis.
        </p>
        <h2>Give every scene a job</h2>
        <p>
          A short video has little room for filler. Let the opening orient the
          viewer, the middle show one useful action, and the last frame land on
          the result.
        </p>
        <p>
          In the studio, start with a screenshot or write one sentence about the
          moment you want to show. Then refine the timing and detail until it
          feels like your product.
        </p>
        <Link className="button button-primary" to="/studio">
          Try it in the studio <ArrowRight size={15} />
        </Link>
      </div>
    </main>
  );
}

export function LegalPage({
  kind,
}: {
  kind: "terms" | "privacy" | "refund" | "contact";
}) {
  const content = {
    terms: {
      eyebrow: "LEGAL / TERMS",
      title: "Terms of service",
      body: [
        [
          "Using the service",
          "Claude Motion Video helps you create short animations from your own descriptions and images. You need an account to create videos and must be at least 16 years old.",
        ],
        [
          "Your content",
          "You keep rights to the content you provide and videos you create. You are responsible for having permission to use uploaded images, names, marks and recognizable people.",
        ],
        [
          "Credits and subscriptions",
          "Credits are consumed when a generation or edit starts. Failed jobs that do not produce a video return credits automatically. Plans renew until cancelled; cancellation takes effect at the end of the paid period.",
        ],
        [
          "Acceptable use",
          "Do not use the service to break the law, infringe rights, harass people, create deceptive endorsements or bypass usage limits. AI results can contain errors; review them before publishing.",
        ],
      ],
    },
    privacy: {
      eyebrow: "LEGAL / PRIVACY",
      title: "Privacy policy",
      body: [
        [
          "Information we use",
          "We process account details, prompts, uploaded images, generated videos and usage records to operate the service, protect accounts and provide support.",
        ],
        [
          "How content is handled",
          "Prompts and files are sent to the AI and storage providers needed to create and save your work. Access is restricted to your account. Do not upload content you do not have permission to use.",
        ],
        [
          "Your choices",
          "You can request account deletion or contact us with privacy questions. We use the minimum information needed to provide the service and maintain billing records.",
        ],
      ],
    },
    refund: {
      eyebrow: "LEGAL / REFUNDS",
      title: "Refund policy",
      body: [
        [
          "Unused credits",
          "If a generation fails on our side or cannot produce a video, the credits used for that job are returned automatically. For subscription charge questions, contact support so we can review the account and payment.",
        ],
        [
          "Failed generations",
          "Credits are returned automatically when a generation fails on our side or cannot produce a video.",
        ],
        [
          "Subscriptions",
          "You can cancel at any time. Access continues through the paid billing period. Charges are not prorated for unused time.",
        ],
      ],
    },
    contact: {
      eyebrow: "SAY HELLO",
      title: "Talk to the studio.",
      body: [
        [
          "Support",
          "For account, billing or product questions, email cuilinhao2015@gmail.com. Include the email address on your account and a short description of the issue.",
        ],
        [
          "Press and partnerships",
          "For collaborations or press requests, email cuilinhao2015@gmail.com with “Partnerships” in the subject.",
        ],
      ],
    },
  }[kind];
  return (
    <main className="wrap content-page legal-page">
      <p className="eyebrow">{content.eyebrow}</p>
      <h1>{content.title}</h1>
      <p className="legal-updated">Last updated October 18, 2026</p>
      <div className="legal-body">
        {content.body.map(([h, p]) => (
          <section key={h}>
            <h2>{h}</h2>
            <p>{p}</p>
          </section>
        ))}
      </div>
      <p className="fine-print">
        Questions? <Link to="/contact">Contact us</Link>.
      </p>
    </main>
  );
}

export function NotFound() {
  return (
    <main className="wrap content-page">
      <div className="page-title">
        <p className="eyebrow">404 / LOST FRAME</p>
        <h1>
          Nothing
          <br />
          <span className="text-outline">to see.</span>
        </h1>
        <Link className="button button-primary" to="/">
          Back to home <ArrowRight size={15} />
        </Link>
      </div>
    </main>
  );
}
