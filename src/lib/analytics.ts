type GoogleTag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GoogleTag;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

const productionHosts = new Set(['claudemotionvideo.com', 'www.claudemotionvideo.com']);
const pageTitles = new Map([
  ['/', 'Text Animation Generator'],
  ['/text-animation-generator', 'Text Animation Generator'],
  ['/animated-title-generator', 'Animated Title Generator'],
  ['/effects/letter-drop-animation', 'Letter Drop Animation'],
  ['/effects/masked-rise-animation', 'Masked Rise Animation'],
  ['/effects/typewriter-cursor-animation', 'Typewriter Cursor Animation'],
  ['/effects/stretch-slide-in-animation', 'Stretch Slide-in Animation'],
  ['/effects/squash-and-stretch-animation', 'Squash and Stretch Animation'],
  ['/effects/outline-echo-effect', 'Outline Echo Effect'],
  ['/effects/decode-scramble-text-effect', 'Decode Scramble Text Effect'],
  ['/effects/skewed-wipe-transition', 'Skewed Wipe Transition'],
  ['/pricing', 'Pricing'],
  ['/examples', 'Examples'],
  ['/effects', 'Motion Effects'],
  ['/blogs', 'Blogs'],
  ['/studio', 'Studio'],
  ['/terms', 'Terms of Service'],
  ['/privacy', 'Privacy Policy'],
  ['/refund', 'Refund Policy'],
  ['/refunds', 'Refund Policy'],
  ['/featured', 'Featured on'],
  ['/opus-5-5-video-generator', 'Opus 5.5 Video Generator'],
  ['/blogs/opus-5-5-video-prompt-guide', 'Opus 5.5 Video Prompt Guide'],
  ['/blogs/opus-5-5-video-examples', 'Opus 5.5 Video Examples'],
  ['/contact', 'Contact'],
  ['/blogs/writing-a-motion-brief', 'Writing a motion brief that keeps your product intact'],
  ['/blogs/from-screen-to-story', 'From one screen to a short product story'],
  ['/blogs/small-movements', 'Small movements, sharper interfaces'],
  ['/blogs/social-formats', 'Choosing a format before you choose a cut'],
]);

let initialized = false;
let lastPathname: string | null = null;
let previousPageLocation: string | undefined;

function initialReferrer(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    // External referrers need only an origin for source attribution. Never send
    // arbitrary path segments, query parameters, or fragments from a referrer.
    const pathname = productionHosts.has(url.hostname) && pageTitles.has(url.pathname)
      ? url.pathname : '/';
    return `${url.origin}${pathname}`;
  } catch {
    return '';
  }
}

export function trackPageView(pathname: string): void {
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
  if (
    !import.meta.env.PROD || !measurementId || !/^G-[A-Z0-9]{10}$/.test(measurementId)
    || typeof window === 'undefined' || typeof document === 'undefined'
    || window.location.protocol !== 'https:' || !productionHosts.has(window.location.hostname)
  ) return;

  const target = window;
  const title = pageTitles.get(pathname);
  if (!title) {
    // Reset-password and unknown routes can contain private material. Do not
    // initialize here, and suspend automatic engagement from an existing tag.
    if (initialized) target[`ga-disable-${measurementId}`] = true;
    lastPathname = null;
    return;
  }
  target[`ga-disable-${measurementId}`] = false;
  if (lastPathname === pathname) return;

  const context = {
    page_location: `${window.location.origin}${pathname}`,
    page_referrer: previousPageLocation ?? initialReferrer(document.referrer),
    page_title: `${title} — Claude Motion Video`,
  };
  target.dataLayer ??= [];
  target.gtag ??= function (..._args: unknown[]) {
    target.dataLayer!.push(arguments);
  };
  if (!initialized) target.gtag('js', new Date());
  // Set a clean global context before config so automatic engagement events
  // also use these URLs; event-only overrides would leave their defaults unsafe.
  target.gtag('set', context);
  if (!initialized) {
    target.gtag('config', measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);
    initialized = true;
  }
  // Enhanced Measurement's history tracking must also be disabled in GA4.
  target.gtag('event', 'page_view', { ...context, send_to: measurementId });
  lastPathname = pathname;
  previousPageLocation = context.page_location;
}
